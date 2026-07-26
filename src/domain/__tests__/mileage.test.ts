import { monthRange } from '../captureMetrics';
import { costPerMile, summarizeTrips, TripLike, tripsInRange } from '../mileage';

const trip = (over: Partial<TripLike>): TripLike => ({
  loadedMiles: 500,
  deadheadMiles: 50,
  date: null,
  createdAt: Date.UTC(2026, 6, 10),
  ...over,
});

describe('summarizeTrips', () => {
  it('is all-zero with a null deadhead ratio for no trips', () => {
    expect(summarizeTrips([])).toEqual({
      tripCount: 0,
      totalMiles: 0,
      loadedMiles: 0,
      deadheadMiles: 0,
      deadheadPct: null,
    });
  });

  it('sums loaded and deadhead miles and computes the deadhead share', () => {
    const s = summarizeTrips([
      trip({ loadedMiles: 400, deadheadMiles: 100 }),
      trip({ loadedMiles: 300, deadheadMiles: 200 }),
    ]);
    expect(s.tripCount).toBe(2);
    expect(s.loadedMiles).toBe(700);
    expect(s.deadheadMiles).toBe(300);
    expect(s.totalMiles).toBe(1000);
    expect(s.deadheadPct).toBeCloseTo(0.3);
  });

  it('ignores negative or non-finite mile values', () => {
    const s = summarizeTrips([
      trip({ loadedMiles: -50, deadheadMiles: 20 }),
      trip({ loadedMiles: Number.NaN, deadheadMiles: 10 }),
    ]);
    expect(s.loadedMiles).toBe(0);
    expect(s.deadheadMiles).toBe(30);
  });
});

describe('tripsInRange', () => {
  it('keeps only trips within the month', () => {
    const kept = tripsInRange(
      [trip({ date: '2026-07-05' }), trip({ date: '2026-08-05' }), trip({ date: '2026-06-30' })],
      monthRange(new Date(2026, 6, 19)),
    );
    expect(kept).toHaveLength(1);
  });
});

describe('costPerMile', () => {
  it('divides expenses by miles', () => {
    expect(costPerMile(1000, 500)).toBe(2);
    expect(costPerMile(1234.56, 789)).toBe(1.56);
  });

  it('is null with no miles (avoids divide-by-zero)', () => {
    expect(costPerMile(500, 0)).toBeNull();
    expect(costPerMile(0, 0)).toBeNull();
  });
});
