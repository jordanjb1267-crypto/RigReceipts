import { AppState } from 'react-native';

import { deriveActionItems } from '@/domain';

import {
  captureProductNowMs,
  inspectProductNowScheduler,
  PRODUCT_NOW_FOREGROUND_CADENCE_MS,
  readProductNowMs,
  resetProductNowSchedulerForTests,
  subscribeProductNow,
} from '../productNow';

describe('productNow freshness (RR-PR15-002 + pre-promotion gate)', () => {
  let appStateHandler: ((state: string) => void) | null = null;
  let appStateRemoveCount = 0;

  beforeEach(() => {
    resetProductNowSchedulerForTests();
    appStateHandler = null;
    appStateRemoveCount = 0;
    const spy = jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, cb) => {
      appStateHandler = cb as (state: string) => void;
      return {
        remove: () => {
          appStateRemoveCount += 1;
          appStateHandler = null;
        },
      };
    });
    spy.mockClear();
  });

  afterEach(() => {
    resetProductNowSchedulerForTests();
    jest.restoreAllMocks();
    jest.useRealTimers();
    captureProductNowMs(Date.now());
  });

  it('A: initialization is finite/current, not epoch zero', () => {
    const before = Date.now();
    const n = readProductNowMs();
    const after = Date.now();
    expect(Number.isFinite(n)).toBe(true);
    expect(n).not.toBe(0);
    expect(n).toBeGreaterThanOrEqual(before - 5_000);
    expect(n).toBeLessThanOrEqual(after + 5_000);
  });

  it('B: explicit capture still rejects NaN and infinite values', () => {
    expect(() => captureProductNowMs(Number.NaN)).toThrow(/nowMs/);
    expect(() => captureProductNowMs(Number.POSITIVE_INFINITY)).toThrow(/nowMs/);
    expect(() => captureProductNowMs(Number.NEGATIVE_INFINITY)).toThrow(/nowMs/);
  });

  it('C: simulated foreground/resume refresh advances the clock', () => {
    const t0 = Date.parse('2026-09-09T00:00:00.000Z');
    jest.useFakeTimers();
    jest.setSystemTime(t0);
    captureProductNowMs(t0);
    const stop = subscribeProductNow(() => undefined);
    expect(appStateHandler).toEqual(expect.any(Function));

    const tResume = t0 + 90 * 60_000;
    jest.setSystemTime(tResume);
    appStateHandler?.('active');
    expect(readProductNowMs()).toBe(tResume);

    appStateHandler?.('background');
    expect(readProductNowMs()).toBe(tResume);
    stop();
  });

  it('D: bounded timer refresh advances the clock', () => {
    const t0 = Date.parse('2026-09-09T00:00:00.000Z');
    jest.useFakeTimers();
    jest.setSystemTime(t0);
    captureProductNowMs(t0);
    const stop = subscribeProductNow(() => undefined);
    jest.advanceTimersByTime(0);
    expect(readProductNowMs()).toBe(t0);

    jest.advanceTimersByTime(PRODUCT_NOW_FOREGROUND_CADENCE_MS);
    expect(readProductNowMs()).toBe(t0 + PRODUCT_NOW_FOREGROUND_CADENCE_MS);
    expect(inspectProductNowScheduler().cadenceArmed).toBe(true);
    stop();
  });

  it('E: multiple subscribers share one AppState listener and one cadence timer', () => {
    const t0 = Date.parse('2026-09-09T00:00:00.000Z');
    jest.useFakeTimers();
    jest.setSystemTime(t0);
    const a = subscribeProductNow(() => undefined);
    const b = subscribeProductNow(() => undefined);
    expect(AppState.addEventListener).toHaveBeenCalledTimes(1);
    expect(inspectProductNowScheduler()).toMatchObject({
      subscribers: 2,
      appStateAttached: true,
      cadenceArmed: true,
    });
    const timersAfterTwo = jest.getTimerCount();
    const c = subscribeProductNow(() => undefined);
    expect(AppState.addEventListener).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(timersAfterTwo);
    expect(inspectProductNowScheduler().subscribers).toBe(3);
    a();
    b();
    c();
  });

  it('F: last unsubscribe tears down AppState and cadence scheduling', () => {
    jest.useFakeTimers();
    jest.setSystemTime(Date.parse('2026-09-09T00:00:00.000Z'));
    const a = subscribeProductNow(() => undefined);
    const b = subscribeProductNow(() => undefined);
    expect(inspectProductNowScheduler().appStateAttached).toBe(true);
    a();
    expect(inspectProductNowScheduler().subscribers).toBe(1);
    expect(inspectProductNowScheduler().appStateAttached).toBe(true);
    b();
    expect(inspectProductNowScheduler()).toEqual({
      subscribers: 0,
      cadenceArmed: false,
      appStateAttached: false,
      immediateArmed: false,
    });
    expect(appStateRemoveCount).toBe(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('G: pending receivable crossing >30 days flips urgency without mutating status', () => {
    const due = '2026-08-10';
    const soonNow = Date.parse('2026-09-09T00:00:00.000Z');
    const overdueNow = Date.parse('2026-09-10T01:00:00.000Z');
    const receivable = {
      id: 'rcv_age',
      loadId: 'load_1',
      type: 'detention' as const,
      status: 'pending' as const,
      amountExpected: 150,
      amountReceived: 0,
      dateDue: due,
    };
    const load = {
      id: 'load_1',
      loadNumber: '1',
      origin: 'A',
      destination: 'B',
      status: 'in_transit' as const,
      grossRate: 2000,
      loadedMiles: 500,
      bolRequired: true,
    };
    const docs = [
      { loadId: 'load_1', docType: 'rate_confirmation' as const, status: 'captured' as const },
      { loadId: 'load_1', docType: 'pod' as const, status: 'captured' as const },
      { loadId: 'load_1', docType: 'bol' as const, status: 'captured' as const },
    ];

    jest.useFakeTimers();
    jest.setSystemTime(soonNow);
    captureProductNowMs(soonNow);
    const stop = subscribeProductNow(() => undefined);
    jest.advanceTimersByTime(0);

    const soonItems = deriveActionItems({
      loads: [load],
      docs,
      captures: [],
      receivables: [receivable],
      segments: [],
      nowMs: readProductNowMs(),
    });
    expect(soonItems.find((i) => i.kind === 'receivable_attention')?.urgency).toBe('soon');
    expect(receivable.status).toBe('pending');

    jest.setSystemTime(overdueNow);
    appStateHandler?.('active');

    const nowItems = deriveActionItems({
      loads: [load],
      docs,
      captures: [],
      receivables: [receivable],
      segments: [],
      nowMs: readProductNowMs(),
    });
    expect(readProductNowMs()).toBe(overdueNow);
    expect(nowItems.find((i) => i.kind === 'receivable_attention')?.urgency).toBe('now');
    expect(receivable.status).toBe('pending');
    stop();
  });
});
