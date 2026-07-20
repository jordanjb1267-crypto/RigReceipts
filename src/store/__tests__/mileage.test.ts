import { activeSegment, loadMileage, summarizeSegments } from '@/domain';

import { useMileageStore } from '../mileage';

const reset = () => useMileageStore.getState().clear();
const segs = () => useMileageStore.getState().segments;
const active = () => activeSegment(segs());

describe('mileage store — the driver-confirmed state machine (§17, §19)', () => {
  beforeEach(reset);

  it('runs the full acceptance flow: pickup → deadhead → loaded → delivered → next', () => {
    const s = useMileageStore.getState();

    // Step: Going to Pick Up a Load → deadhead against L1.
    s.startTracking({ category: 'deadhead', subtype: 'to_pickup' }, { loadId: 'L1' });
    expect(active()).toMatchObject({ accountingCategory: 'deadhead', loadId: 'L1', endedAt: null });
    expect(useMileageStore.getState().activeSessionId).not.toBeNull();

    s.appendMiles(52.3);
    expect(active()?.calculatedMiles).toBeCloseTo(52.3, 5);

    // I'm Loaded → deadhead closes, loaded opens on the same load.
    s.imLoaded();
    expect(active()).toMatchObject({ accountingCategory: 'loaded', loadId: 'L1', endedAt: null });
    // The deadhead segment is now closed with its miles preserved.
    const deadhead = segs().find((x) => x.accountingCategory === 'deadhead');
    expect(deadhead?.endedAt).not.toBeNull();
    expect(deadhead?.calculatedMiles).toBeCloseTo(52.3, 5);

    s.appendMiles(301.8);
    expect(active()?.calculatedMiles).toBeCloseTo(301.8, 5);

    // Mark Delivered → loaded closes; a NEW unclassified segment opens (never auto-classified).
    s.markDelivered();
    expect(active()).toMatchObject({
      accountingCategory: 'unclassified',
      loadId: null,
      endedAt: null,
    });

    // What's next: Going to My Next Pickup → deadhead against L2.
    s.beginSegment({ category: 'deadhead', subtype: 'to_pickup' }, { loadId: 'L2' });
    expect(active()).toMatchObject({ accountingCategory: 'deadhead', loadId: 'L2' });

    // Load profitability: L1 got its loaded + deadhead miles, and only those.
    const l1 = loadMileage(segs(), 'L1');
    expect(l1.loadedMiles).toBeCloseTo(301.8, 1);
    expect(l1.deadheadMiles).toBeCloseTo(52.3, 1);
    expect(l1.totalMiles).toBeCloseTo(354.1, 1);

    // Categories stay mutually exclusive.
    const b = summarizeSegments(segs());
    expect(b.total).toBeCloseTo(
      b.loaded + b.deadhead + b.businessEmpty + b.personal + b.unclassified,
      1,
    );
  });

  it('never leaves miles double-counted after a correction', () => {
    const s = useMileageStore.getState();
    s.startTracking({ category: 'deadhead', subtype: 'to_pickup' }, { loadId: 'L1' });
    s.appendMiles(100);
    const id = active()!.id;
    // Correct the segment to loaded with adjusted miles.
    s.editSegment(id, { accountingCategory: 'loaded', adjustedMiles: 88, loadId: 'L1' });
    const b = summarizeSegments(segs());
    expect(b.loaded).toBe(88); // adjusted wins
    expect(b.deadhead).toBe(0); // no longer counted as deadhead
    expect(segs().find((x) => x.id === id)?.calculatedMiles).toBe(100); // original preserved
  });

  it('classifies unclassified miles only on explicit user action', () => {
    const s = useMileageStore.getState();
    s.startSession();
    s.beginSegment({ category: 'unclassified', subtype: null }, {});
    s.appendMiles(42);
    const id = active()!.id;
    expect(summarizeSegments(segs()).unclassified).toBe(42);
    s.classifySegment(id, { category: 'business_empty', subtype: 'repositioning' });
    expect(summarizeSegments(segs()).unclassified).toBe(0);
    expect(summarizeSegments(segs()).businessEmpty).toBe(42);
    expect(segs().find((x) => x.id === id)?.userConfirmed).toBe(true);
  });

  it('stopSession closes the active segment and clears the active session', () => {
    const s = useMileageStore.getState();
    s.startTracking({ category: 'loaded', subtype: null }, { loadId: 'L1' });
    s.stopSession();
    expect(active()).toBeNull();
    expect(useMileageStore.getState().activeSessionId).toBeNull();
  });

  it('manual entry uses the same segment model', () => {
    const s = useMileageStore.getState();
    s.addManualSegment({ date: '2026-07-04', miles: 120, category: 'deadhead', loadId: 'L9' });
    expect(loadMileage(segs(), 'L9').deadheadMiles).toBe(120);
    expect(segs()[0]).toMatchObject({ classificationSource: 'manual', userConfirmed: true });
  });
});
