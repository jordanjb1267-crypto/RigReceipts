import {
  accumulateMiles,
  DEFAULT_ACCUMULATOR,
  GeoFix,
  haversineMiles,
  initialAccumulator,
  stepAccumulator,
} from '@/domain';

// ~1 degree of latitude ≈ 69.09 mi, so this is close to 1 mile of latitude.
const MILE_LAT_DEG = 1 / 69.09;

const fix = (lat: number, lng: number, timestampMs: number, accuracyMeters = 5): GeoFix => ({
  lat,
  lng,
  accuracyMeters,
  timestampMs,
});

describe('haversineMiles', () => {
  it('is zero for the same point', () => {
    expect(haversineMiles({ lat: 40, lng: -100 }, { lat: 40, lng: -100 })).toBe(0);
  });

  it('matches a known distance (roughly)', () => {
    // ~1 degree of latitude ≈ 69 miles.
    const d = haversineMiles({ lat: 40, lng: -100 }, { lat: 41, lng: -100 });
    expect(d).toBeGreaterThan(68);
    expect(d).toBeLessThan(70);
  });

  it('is symmetric', () => {
    const a = { lat: 34.05, lng: -118.24 };
    const b = { lat: 36.16, lng: -115.15 };
    expect(haversineMiles(a, b)).toBeCloseTo(haversineMiles(b, a), 6);
  });
});

describe('stepAccumulator', () => {
  it('adds nothing on the first fix but sets the reference', () => {
    const step = stepAccumulator(initialAccumulator(), fix(40, -100, 0));
    expect(step.deltaMiles).toBe(0);
    expect(step.outcome).toBe('first');
    expect(step.state.last).not.toBeNull();
  });

  it('accumulates real movement at a highway speed', () => {
    // ~1 mile in 60 s ≈ 60 mph — well under the spike cap.
    const s1 = stepAccumulator(initialAccumulator(), fix(40, -100, 0));
    const s2 = stepAccumulator(s1.state, fix(40 + MILE_LAT_DEG, -100, 60_000));
    expect(s2.outcome).toBe('accepted');
    expect(s2.deltaMiles).toBeGreaterThan(0.9);
    expect(s2.deltaMiles).toBeLessThan(1.1);
  });

  it('rejects poor-accuracy fixes without moving the reference', () => {
    const s1 = stepAccumulator(initialAccumulator(), fix(40, -100, 0));
    const s2 = stepAccumulator(s1.state, fix(40 + MILE_LAT_DEG, -100, 60_000, 500));
    expect(s2.outcome).toBe('poor_accuracy');
    expect(s2.deltaMiles).toBe(0);
    expect(s2.state.last).toBe(s1.state.last);
  });

  it('ignores stationary jitter and holds the reference so drift cannot creep', () => {
    const anchor = fix(40, -100, 0);
    const s1 = stepAccumulator(initialAccumulator(), anchor);
    // A cluster of tiny wobbles that oscillate around the anchor, none past the
    // min step — parked-truck GPS noise.
    let state = s1.state;
    let total = 0;
    for (let i = 1; i <= 20; i++) {
      const wobble = (i % 2 === 0 ? 1 : -1) * 0.00001; // ~0.0007 mi off the anchor
      const step = stepAccumulator(state, fix(40 + wobble, -100, i * 1000));
      state = step.state;
      total += step.deltaMiles;
    }
    expect(total).toBe(0);
    expect(state.last).toBe(anchor); // reference never advanced
  });

  it('re-anchors across a coverage gap without fabricating the miles', () => {
    const s1 = stepAccumulator(initialAccumulator(), fix(40, -100, 0));
    // 30 minutes later and 100 mi away — a signal gap, not a measured drive.
    const s2 = stepAccumulator(s1.state, fix(41.5, -100, 30 * 60_000));
    expect(s2.outcome).toBe('gap');
    expect(s2.deltaMiles).toBe(0);
    expect(s2.state.last?.lat).toBe(41.5); // reference moved forward
  });

  it('drops physically impossible GPS spikes', () => {
    const s1 = stepAccumulator(initialAccumulator(), fix(40, -100, 0));
    // ~69 mi in 1 second → thousands of mph.
    const s2 = stepAccumulator(s1.state, fix(41, -100, 1000));
    expect(s2.outcome).toBe('spike');
    expect(s2.deltaMiles).toBe(0);
    expect(s2.state.last).toBe(s1.state.last);
  });

  it('ignores out-of-order timestamps', () => {
    const s1 = stepAccumulator(initialAccumulator(), fix(40, -100, 10_000));
    const s2 = stepAccumulator(s1.state, fix(40 + MILE_LAT_DEG, -100, 5_000));
    expect(s2.deltaMiles).toBe(0);
    expect(s2.state.last).toBe(s1.state.last);
  });
});

describe('accumulateMiles', () => {
  it('sums a clean straight-line drive', () => {
    // Three ~1-mile legs, one minute apart (≈60 mph).
    const fixes: GeoFix[] = [
      fix(40 + 0 * MILE_LAT_DEG, -100, 0),
      fix(40 + 1 * MILE_LAT_DEG, -100, 60_000),
      fix(40 + 2 * MILE_LAT_DEG, -100, 120_000),
      fix(40 + 3 * MILE_LAT_DEG, -100, 180_000),
    ];
    const total = accumulateMiles(fixes);
    const direct = haversineMiles({ lat: 40, lng: -100 }, { lat: 40 + 3 * MILE_LAT_DEG, lng: -100 });
    expect(total).toBeCloseTo(direct, 1);
    expect(total).toBeGreaterThan(2.9);
  });

  it('excludes gap distance from the total', () => {
    const fixes: GeoFix[] = [
      fix(40, -100, 0),
      fix(40 + MILE_LAT_DEG, -100, 60_000), // measured leg ~1 mi
      fix(42.0, -100, 30 * 60_000), // after a gap — must not count
      fix(42.0 + MILE_LAT_DEG, -100, 30 * 60_000 + 60_000), // measured leg ~1 mi
    ];
    const total = accumulateMiles(fixes);
    const leg = haversineMiles({ lat: 40, lng: -100 }, { lat: 40 + MILE_LAT_DEG, lng: -100 });
    expect(total).toBeCloseTo(leg * 2, 1); // two short legs, no ~140-mi gap
  });

  it('honors a custom config', () => {
    // ~0.5 mi step in 60 s (≈30 mph, not a spike); a 1-mi min step rejects it.
    const fixes: GeoFix[] = [fix(40, -100, 0), fix(40 + 0.5 * MILE_LAT_DEG, -100, 60_000)];
    const strict = accumulateMiles(fixes, { ...DEFAULT_ACCUMULATOR, minStepMiles: 1 });
    expect(strict).toBe(0);
  });
});
