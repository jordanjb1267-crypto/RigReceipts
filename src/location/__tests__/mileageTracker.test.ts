import { activeSegment, GeoFix, haversineMiles } from '@/domain';
import { ingestFix, resetTracking } from '@/location/mileageTracker';
import { useMileageStore } from '@/store/mileage';

// ~1 degree of latitude ≈ 69.09 mi.
const MILE_LAT_DEG = 1 / 69.09;

const fix = (lat: number, lng: number, timestampMs: number): GeoFix => ({
  lat,
  lng,
  accuracyMeters: 5,
  timestampMs,
});

const activeMiles = () => activeSegment(useMileageStore.getState().segments)?.calculatedMiles ?? 0;

beforeEach(() => {
  useMileageStore.getState().clear();
  resetTracking();
});

describe('ingestFix wiring', () => {
  it('adds accepted GPS miles to the active segment', () => {
    useMileageStore.getState().startTracking({ category: 'loaded', subtype: null });

    ingestFix(fix(40.0, -100, 0)); // first — sets reference, adds nothing
    expect(activeMiles()).toBe(0);

    ingestFix(fix(40 + MILE_LAT_DEG, -100, 60_000)); // ~1 mi at ~60 mph
    const expected = haversineMiles({ lat: 40, lng: -100 }, { lat: 40 + MILE_LAT_DEG, lng: -100 });
    expect(activeMiles()).toBeCloseTo(expected, 3);
  });

  it('invents no miles when there is no active segment', () => {
    // GPS running with nothing confirmed must not create classified distance.
    ingestFix(fix(40.0, -100, 0));
    const added = ingestFix(fix(40 + MILE_LAT_DEG, -100, 60_000));
    expect(added).toBeGreaterThan(0); // the accumulator still measured movement
    // ...but the store swallowed it because no segment was open.
    expect(useMileageStore.getState().segments).toHaveLength(0);
    expect(useMileageStore.getState().sessions).toHaveLength(0);
  });

  it('never fabricates gap distance into the segment', () => {
    useMileageStore.getState().startTracking({ category: 'loaded', subtype: null });
    ingestFix(fix(40.0, -100, 0));
    ingestFix(fix(40 + 0.5 * MILE_LAT_DEG, -100, 30_000)); // measured leg ~0.5 mi at ~60 mph
    const beforeGap = activeMiles();
    expect(beforeGap).toBeGreaterThan(0);
    ingestFix(fix(42.0, -100, 30 * 60_000)); // 30-min gap, ~140 mi — must not count
    expect(activeMiles()).toBe(beforeGap);
  });
});
