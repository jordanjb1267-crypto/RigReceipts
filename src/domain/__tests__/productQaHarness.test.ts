/**
 * Deterministic product QA harness. Drives the same functions the Dashboard,
 * Loads, Load Economics Packet, Scan, and Live Mileage screens already use.
 * Local fixtures only — no production accounts, flags, or cloud writes.
 */
import { attachConfirmedCaptureToLoad } from '@/data/loadScanAttach';
import { launchAction } from '@/data/launchAction';
import {
  PRODUCT_QA_NOW_MS,
  QA_ACTIVE_BOOKED,
  QA_ALL_LOADS,
  QA_CLOSED_PAID,
  QA_COMPLETE_DOCS,
  QA_DELIVERED,
  QA_LIVE_SEGMENT,
  QA_NEEDS_ACTION_TRANSIT,
  QA_SAVED_OFFER,
  QA_SAVED_OFFER_NEEDS_GROSS,
} from '@/data/productQaFixtures';
import { useCapturesStore } from '@/store/captures';
import { useLoadDocsStore } from '@/store/loadDocs';
import { useScanContextStore } from '@/store/scanContext';

import {
  actionItemsForLoad,
  buildLoadEconomicsPacket,
  deriveActionItems,
  groupLoadsForList,
  loadListGroupFor,
  loadMileage,
  loadStatusLabel,
  nextLoadStatus,
  plannedMilesFromLoad,
  SCAN_TYPES,
} from '..';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const nodeFs = require('node:fs') as { readFileSync(path: string, enc: string): string };
const read = (p: string) => nodeFs.readFileSync(p, 'utf8');

const loadsScreen = read('src/app/(tabs)/loads.tsx');
const dashboard = read('src/app/(tabs)/index.tsx');
const scanScreen = read('src/app/(tabs)/scan.tsx');
const loadDetail = read('src/app/load-detail.tsx');
const liveMileage = read('src/app/live-mileage.tsx');
const flags = read('src/config/flags.ts');

const deriveFor = (
  loads: typeof QA_ALL_LOADS,
  docs:
    | ReturnType<typeof QA_COMPLETE_DOCS>
    | readonly { loadId: string; docType: string; status: string }[],
) =>
  deriveActionItems({
    loads,
    docs: docs as never,
    captures: [],
    receivables: [],
    segments: [],
    nowMs: PRODUCT_QA_NOW_MS,
  });

describe('product QA harness — list grouping (scenarios 1–5)', () => {
  const docs = [...QA_COMPLETE_DOCS(QA_ACTIVE_BOOKED.id), ...QA_COMPLETE_DOCS(QA_CLOSED_PAID.id)];
  const items = deriveFor(QA_ALL_LOADS, docs);
  const grouped = groupLoadsForList(QA_ALL_LOADS, items);

  it('SCENARIO 1 — evaluated offer is Saved, never Active', () => {
    expect(loadListGroupFor(QA_SAVED_OFFER, items)).toBe('saved');
    expect(grouped.saved.map((l) => l.id)).toEqual(
      expect.arrayContaining([QA_SAVED_OFFER.id, QA_SAVED_OFFER_NEEDS_GROSS.id]),
    );
    expect(grouped.active.map((l) => l.id)).not.toContain(QA_SAVED_OFFER.id);
    expect(loadStatusLabel(QA_SAVED_OFFER.status)).toBe('Evaluated');
    expect(QA_SAVED_OFFER.status).toBe('evaluated');
    expect(nextLoadStatus('evaluated')).toBe('booked');

    const later = actionItemsForLoad(items, QA_SAVED_OFFER_NEEDS_GROSS.id);
    expect(later.some((i) => i.kind === 'incomplete_economics')).toBe(true);
    expect(loadListGroupFor(QA_SAVED_OFFER_NEEDS_GROSS, items)).toBe('saved');
  });

  it('SCENARIO 2 — clean booked load is Active', () => {
    expect(loadListGroupFor(QA_ACTIVE_BOOKED, items)).toBe('active');
    expect(grouped.active.map((l) => l.id)).toEqual([QA_ACTIVE_BOOKED.id]);
    expect(grouped.saved.map((l) => l.id)).not.toContain(QA_ACTIVE_BOOKED.id);
    expect(grouped.needsAction.map((l) => l.id)).not.toContain(QA_ACTIVE_BOOKED.id);
    expect(actionItemsForLoad(items, QA_ACTIVE_BOOKED.id)).toEqual([]);
  });

  it('SCENARIO 3 — in_transit with missing required doc is Needs Action', () => {
    expect(loadListGroupFor(QA_NEEDS_ACTION_TRANSIT, items)).toBe('needs_action');
    const next = actionItemsForLoad(items, QA_NEEDS_ACTION_TRANSIT.id)[0];
    expect(next?.kind).toBe('missing_document');
    expect(next?.title).toMatch(/Scan/);
    expect(next?.deepLink).toEqual({
      pathname: '/(tabs)/scan',
      params: expect.objectContaining({
        loadId: QA_NEEDS_ACTION_TRANSIT.id,
        intendedDocType: expect.any(String),
        sourceAction: 'missing_document',
      }),
    });
  });

  it('SCENARIO 4 — delivered stays Needs Action and does not imply broker payment', () => {
    expect(loadListGroupFor(QA_DELIVERED, [])).toBe('needs_action');
    expect(grouped.needsAction.map((l) => l.id)).toContain(QA_DELIVERED.id);
    const packet = buildLoadEconomicsPacket({
      load: QA_DELIVERED,
      docs: [],
      captures: [],
      slots: [],
      captureRecords: [],
      receivables: [],
      segments: [],
      targets: null,
      nowMs: PRODUCT_QA_NOW_MS,
    });
    expect(packet.externallyDelivered).toBe(false);
    expect(packet.recipientAccepted).toBe(false);
    expect(packet.localComplete).toBe(false);
  });

  it('SCENARIO 5 — paid is Closed', () => {
    expect(loadListGroupFor(QA_CLOSED_PAID, items)).toBe('closed');
    expect(grouped.closed.map((l) => l.id)).toEqual([QA_CLOSED_PAID.id]);
  });
});

describe('product QA harness — packet, scan, mileage (scenarios 6–8)', () => {
  it('SCENARIO 6 — Load Economics Packet keeps mile classes and inert delivery', () => {
    const segments = [QA_LIVE_SEGMENT(QA_ACTIVE_BOOKED.id, 688)];
    const packet = buildLoadEconomicsPacket({
      load: QA_ACTIVE_BOOKED,
      docs: [...QA_COMPLETE_DOCS(QA_ACTIVE_BOOKED.id)],
      captures: [],
      slots: QA_COMPLETE_DOCS(QA_ACTIVE_BOOKED.id).map((d, i) => ({
        id: `slot_${i}`,
        loadId: d.loadId,
        docType: d.docType,
        status: d.status,
        scanId: null,
      })),
      captureRecords: [],
      receivables: [],
      segments,
      targets: null,
      nowMs: PRODUCT_QA_NOW_MS,
    });
    expect(packet.grossRate).toBe(2150);
    expect(packet.plannedMiles).toEqual({
      loadedMiles: 720,
      deadheadMiles: 40,
      totalMiles: 760,
    });
    expect(packet.actualLiveMileage?.loadedMiles).toBe(688);
    expect(packet.actualLiveMileage?.totalMiles).toBe(688);
    expect(packet.actualLiveMileage?.totalMiles).not.toBe(packet.plannedMiles.totalMiles);
    expect(packet.paidMiles).toBeNull();
    expect(packet.routeEstimate).toBeNull();
    expect(packet.externallyDelivered).toBe(false);
    expect(packet.recipientAccepted).toBe(false);
    expect(packet.estimatedContribution).toBeNull();
  });

  it('SCENARIO 7 — contextual scan binds, confirms, and attaches locally only', () => {
    useCapturesStore.getState().clear();
    useLoadDocsStore.getState().clear();
    useScanContextStore.getState().clear();

    const items = deriveActionItems({
      loads: [QA_NEEDS_ACTION_TRANSIT],
      docs: [],
      captures: [],
      receivables: [],
      segments: [],
      nowMs: PRODUCT_QA_NOW_MS,
    });
    const missing = items.find((i) => i.kind === 'missing_document');
    expect(missing).toBeDefined();

    const pushed: unknown[] = [];
    launchAction(missing!, { push: (href) => pushed.push(href) });
    const ctx = useScanContextStore.getState().context;
    expect(ctx).toEqual({
      loadId: QA_NEEDS_ACTION_TRANSIT.id,
      intendedDocType: missing?.deepLink.params?.intendedDocType,
      scanType: missing?.deepLink.params?.scanType,
      sourceAction: 'missing_document',
    });
    expect(pushed[0]).toEqual({
      pathname: '/(tabs)/scan',
      params: missing?.deepLink.params,
    });

    const captureId = useCapturesStore.getState().addCapture(
      {
        scanType: ctx?.scanType ?? 'other',
        imageUri: null,
        engine: 'stub',
        rawText: 'BOL SAMPLE',
        vendor: null,
        totalUsd: null,
        date: null,
        gallons: null,
        intendedDocType: ctx?.intendedDocType ?? 'bol',
      },
      { status: 'local_only', accountOwnerId: null },
    );
    attachConfirmedCaptureToLoad(captureId, ctx!.loadId, ctx!.intendedDocType);

    const slot = useLoadDocsStore
      .getState()
      .docs.find((d) => d.loadId === ctx?.loadId && d.docType === ctx?.intendedDocType);
    expect(slot?.status).toBe('captured');
    expect(slot?.scanId).toBe(captureId);
    expect(
      JSON.stringify(useCapturesStore.getState().captures.find((c) => c.id === captureId)),
    ).not.toMatch(/delivered|accepted|auto-send|freightos/i);

    useScanContextStore.getState().clear();
    expect(useScanContextStore.getState().context).toBeNull();
  });

  it('SCENARIO 8 — Live Mileage actuals stay distinct from planned miles', () => {
    const planned = plannedMilesFromLoad(QA_ACTIVE_BOOKED);
    const actual = loadMileage([QA_LIVE_SEGMENT(QA_ACTIVE_BOOKED.id, 688)], QA_ACTIVE_BOOKED.id);
    expect(planned.loadedMiles).toBe(720);
    expect(actual.loadedMiles).toBe(688);
    expect(actual.totalMiles).not.toBe(planned.totalMiles);
    expect(liveMileage).toContain('startForegroundTracking');
    expect(liveMileage).not.toContain('startBackgroundTracking');
    expect(liveMileage).toContain('Background tracking is a');
    expect(liveMileage).toContain('separate flag and is not started here');
  });
});

describe('product QA harness — screen contracts', () => {
  it('Loads list renders Saved / Needs Action / Active / Closed section titles', () => {
    expect(loadsScreen).toContain('title="Saved"');
    expect(loadsScreen).toContain('title="Needs Action"');
    expect(loadsScreen).toContain('title="Active"');
    expect(loadsScreen).toContain('title="Closed"');
    expect(loadsScreen).toContain('groupLoadsForList');
    expect(loadsScreen).toContain('nextLoadStatus');
    expect(loadsScreen).toContain('onAdvance={() => setStatus(l.id, nextLoadStatus(l.status))}');
  });

  it('Dashboard Today / Needs Action is derived, not a second workflow DB', () => {
    expect(dashboard).toContain('Today / Needs Action');
    expect(dashboard).toContain('useActionItems');
    expect(dashboard).toContain('second workflow queue');
  });

  it('Scan requires explicit review/confirm and does not auto-send', () => {
    expect(scanScreen).toContain('Confirm, save & file to load');
    expect(scanScreen).toContain('Check these before saving.');
    expect(scanScreen).toContain('attachConfirmedCaptureToLoad');
    expect(scanScreen).toContain('Nothing is sent externally.');
    expect(scanScreen).toContain('label="Discard"');
    expect(scanScreen).not.toMatch(/auto-send|autosend/i);
  });

  it('Load detail packet keeps delivery/acceptance false in copy and wiring', () => {
    expect(loadDetail).toContain('useLoadEconomicsPacket');
    expect(loadDetail).toContain('Local complete is not shared, delivered, or recipient-accepted');
    expect(loadDetail).toContain('Paid miles are not');
  });

  it('does not enable production flags or expand scan canon', () => {
    expect(SCAN_TYPES).toHaveLength(15);
    expect(flags).toContain("live_mileage_core_enabled: { state: 'off' }");
    expect(flags).toContain("background_mileage_tracking_enabled: { state: 'off' }");
    expect(flags).toContain("carrier_packet_builder_enabled: { state: 'off' }");
    expect(flags).not.toMatch(/state: 'production'/);
  });
});
