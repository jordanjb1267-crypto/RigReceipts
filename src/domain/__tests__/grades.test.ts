import { gradePeriod, letterFor, GRADE_CATEGORIES } from '../grades';

describe('letterFor', () => {
  it('maps scores to the standard bands', () => {
    expect(letterFor(95)).toBe('A');
    expect(letterFor(90)).toBe('A');
    expect(letterFor(85)).toBe('B');
    expect(letterFor(72)).toBe('C');
    expect(letterFor(61)).toBe('D');
    expect(letterFor(40)).toBe('F');
  });
});

describe('gradePeriod', () => {
  it('returns null overall when nothing can be scored', () => {
    const g = gradePeriod({});
    expect(g.letter).toBeNull();
    expect(g.score).toBeNull();
    expect(g.categories).toHaveLength(GRADE_CATEGORIES.length);
    expect(g.categories.every((c) => c.score === null)).toBe(true);
  });

  it('grades a strong week highly', () => {
    const g = gradePeriod({
      achievedAllMileRpm: 2.6,
      targetAllMileRpm: 2.5,
      fuelCostPerMile: 0.6,
      budgetFuelCostPerMile: 0.65,
      deadheadMiles: 40,
      totalMiles: 2600,
      loadsDelivered: 5,
      loadsWithCompletePaperwork: 5,
      openMoneyOwedCount: 0,
    });
    expect(g.score).not.toBeNull();
    expect(g.score!).toBeGreaterThanOrEqual(90);
    expect(g.letter).toBe('A');
  });

  it('penalizes deadhead, missing paperwork, and unpaid money', () => {
    const g = gradePeriod({
      achievedAllMileRpm: 2.0,
      targetAllMileRpm: 2.5,
      deadheadMiles: 650,
      totalMiles: 2600, // 25% empty → ~0
      loadsDelivered: 4,
      loadsWithCompletePaperwork: 2,
      openMoneyOwedCount: 3,
      oldestMoneyOwedDays: 21,
    });
    expect(g.score!).toBeLessThan(70);
    expect(['C', 'D', 'F']).toContain(g.letter);
  });

  it('averages only the categories that have data', () => {
    const g = gradePeriod({ openMoneyOwedCount: 0 }); // only money_owed scores → 100
    expect(g.score).toBe(100);
    expect(g.letter).toBe('A');
    expect(g.categories.filter((c) => c.score !== null)).toHaveLength(1);
  });
});
