import {
  breakEvenAllMileRpm,
  checkLoadRate,
  RpmPlanInputs,
  targetLoadedRpm,
  trueCostPerMile,
  weeklyRevenueNeeded,
} from '../rpm';

const plan: RpmPlanInputs = {
  fixedWeeklyCosts: 1_200,
  variableCostPerMile: 1.1,
  projectedTotalMiles: 2_500,
  expectedLoadedMiles: 2_200,
  desiredDriverPay: 1_500,
  desiredProfitReserve: 500,
};

describe('trueCostPerMile', () => {
  it('divides period expenses by period miles', () => {
    expect(trueCostPerMile(4_600, 2_500)).toBeCloseTo(1.84, 10);
  });

  it('returns null when no miles were run', () => {
    expect(trueCostPerMile(4_600, 0)).toBeNull();
    expect(trueCostPerMile(4_600, -10)).toBeNull();
  });
});

describe('breakEvenAllMileRpm', () => {
  it('covers fixed and variable costs with zero pay/profit', () => {
    // (1200 + 1.1 * 2500) / 2500 = 3950 / 2500 = 1.58
    expect(breakEvenAllMileRpm(1_200, 1.1, 2_500)).toBeCloseTo(1.58, 10);
  });

  it('returns null when no miles are projected', () => {
    expect(breakEvenAllMileRpm(1_200, 1.1, 0)).toBeNull();
  });
});

describe('weeklyRevenueNeeded', () => {
  it('sums fixed, variable-by-miles, driver pay, and profit reserve', () => {
    // 1200 + 1.1*2500 + 1500 + 500 = 5950
    expect(weeklyRevenueNeeded(plan)).toBeCloseTo(5_950, 10);
  });
});

describe('targetLoadedRpm', () => {
  it('divides weekly revenue needed by expected loaded miles', () => {
    // 5950 / 2200 ≈ 2.7045
    expect(targetLoadedRpm(plan)).toBeCloseTo(5_950 / 2_200, 10);
  });

  it('returns null when no loaded miles are expected', () => {
    expect(targetLoadedRpm({ ...plan, expectedLoadedMiles: 0 })).toBeNull();
  });
});

describe('checkLoadRate', () => {
  const base = { targetLoadedRpm: 2.48, breakEvenAllMileRpm: 2.02 };

  it('flags below_break_even when all-mile rate cannot cover costs', () => {
    // 900 / (400 + 100) = 1.80 all-mile < 2.02 break-even
    const result = checkLoadRate({
      ...base,
      offeredPay: 900,
      loadedMiles: 400,
      deadheadMiles: 100,
    });
    expect(result.verdict).toBe('below_break_even');
    expect(result.allMileRpm).toBeCloseTo(1.8, 10);
  });

  it('flags below_target when above break-even but under target', () => {
    // loaded 2.35, all-mile 2.35 (no deadhead) — above 2.02, below 2.48
    const result = checkLoadRate({ ...base, offeredPay: 940, loadedMiles: 400, deadheadMiles: 0 });
    expect(result.verdict).toBe('below_target');
    expect(result.loadedRpm).toBeCloseTo(2.35, 10);
  });

  it('flags on_target within the tolerance band', () => {
    // loaded exactly 2.48
    const result = checkLoadRate({ ...base, offeredPay: 992, loadedMiles: 400, deadheadMiles: 0 });
    expect(result.verdict).toBe('on_target');
  });

  it('flags above_target beyond the tolerance band', () => {
    // loaded 2.61 > 2.48 * 1.02
    const result = checkLoadRate({
      ...base,
      offeredPay: 1_044,
      loadedMiles: 400,
      deadheadMiles: 0,
    });
    expect(result.verdict).toBe('above_target');
    expect(result.loadedRpm).toBeCloseTo(2.61, 10);
  });

  it('deadhead can drag an above-target loaded rate below break-even', () => {
    // loaded 2.61 but 300 deadhead miles → all-mile 1.49
    const result = checkLoadRate({
      ...base,
      offeredPay: 1_044,
      loadedMiles: 400,
      deadheadMiles: 300,
    });
    expect(result.verdict).toBe('below_break_even');
  });

  it('rejects nonpositive loaded miles and negative deadhead', () => {
    expect(() =>
      checkLoadRate({ ...base, offeredPay: 900, loadedMiles: 0, deadheadMiles: 0 }),
    ).toThrow(RangeError);
    expect(() =>
      checkLoadRate({ ...base, offeredPay: 900, loadedMiles: 100, deadheadMiles: -5 }),
    ).toThrow(RangeError);
  });
});
