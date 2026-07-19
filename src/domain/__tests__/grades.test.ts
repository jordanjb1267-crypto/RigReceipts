import {
  CategoryGrade,
  gradePeriod,
  GradeInputs,
  letterFor,
  MIN_GRADABLE_FOR_OVERALL,
} from '../grades';

const cat = (g: ReturnType<typeof gradePeriod>, c: string): CategoryGrade =>
  g.categories.find((x) => x.category === c)!;

describe('letterFor', () => {
  it('maps the standard bands', () => {
    expect(letterFor(95)).toBe('A');
    expect(letterFor(85)).toBe('B');
    expect(letterFor(75)).toBe('C');
    expect(letterFor(65)).toBe('D');
    expect(letterFor(40)).toBe('F');
  });
});

describe('rate grade', () => {
  const base = { targetAllMileRpm: 2.5, breakEvenAllMileRpm: 2.0, loadsCounted: 4 };
  const rate = (achievedAllMileRpm: number) =>
    cat(gradePeriod({ rate: { ...base, achievedAllMileRpm } }), 'rate');

  it('gives A comfortably above target', () => {
    expect(rate(2.8).grade).toBe('A');
  });
  it('gives B at or slightly above target', () => {
    expect(rate(2.5).grade).toBe('B');
    expect(rate(2.55).grade).toBe('B');
  });
  it('gives C profitable but below target', () => {
    const g = rate(2.35);
    expect(g.grade).toBe('C');
    expect(g.reason).toMatch(/below your \$2\.50 target/);
  });
  it('never fails a load that is above break-even', () => {
    // Just above break-even → D at worst, never F.
    expect(rate(2.05).grade).not.toBe('F');
    expect(rate(2.05).score).toBeGreaterThanOrEqual(60);
  });
  it('gives F only below break-even', () => {
    expect(rate(1.8).grade).toBe('F');
  });
  it('is ungradable without a target (no cost profile)', () => {
    const g = cat(gradePeriod({ rate: { achievedAllMileRpm: 2.4, loadsCounted: 3 } }), 'rate');
    expect(g.gradable).toBe(false);
    expect(g.score).toBeNull();
    expect(g.grade).toBeNull();
  });
  it('is ungradable with zero loads counted', () => {
    expect(
      cat(gradePeriod({ rate: { ...base, achievedAllMileRpm: 2.5, loadsCounted: 0 } }), 'rate')
        .gradable,
    ).toBe(false);
  });
});

describe('fuel grade', () => {
  const fuel = (expectedFuelCost: number, actualFuelCost: number) =>
    cat(
      gradePeriod({ fuel: { expectedFuelCost, actualFuelCost, businessMiles: 2000, mpg: 6.5 } }),
      'fuel',
    );

  it('rewards spending below the price-adjusted expectation', () => {
    expect(fuel(1000, 900).grade).toBe('A');
  });
  it('is around C on expectation', () => {
    expect(fuel(1000, 1000).grade).toBe('C');
  });
  it('does not punish a small overage into F', () => {
    expect(fuel(1000, 1030).grade).not.toBe('F');
  });
  it('fails only a material overage', () => {
    expect(fuel(1000, 1200).grade).toBe('F');
  });
  it('is ungradable without MPG', () => {
    const g = cat(
      gradePeriod({
        fuel: { expectedFuelCost: 1000, actualFuelCost: 950, businessMiles: 2000, mpg: 0 },
      }),
      'fuel',
    );
    expect(g.gradable).toBe(false);
    expect(g.score).toBeNull();
  });
  it('uses an override reason when supplied', () => {
    const g = cat(
      gradePeriod({
        fuel: { actualFuelCost: 900 },
        reasons: { fuel: 'Truck MPG has not been configured.' },
      }),
      'fuel',
    );
    expect(g.reason).toBe('Truck MPG has not been configured.');
  });
});

describe('deadhead grade', () => {
  it('grades from the empty-mile share', () => {
    const g = cat(gradePeriod({ deadhead: { deadheadMiles: 180, totalMiles: 1000 } }), 'deadhead');
    expect(g.gradable).toBe(true);
    expect(g.reason).toMatch(/18% of your recorded business miles ran empty/);
  });
  it('is ungradable without miles', () => {
    expect(
      cat(gradePeriod({ deadhead: { deadheadMiles: 100, totalMiles: 0 } }), 'deadhead').gradable,
    ).toBe(false);
  });
});

describe('paperwork grade', () => {
  it('is an A when all required docs are present', () => {
    const g = cat(
      gradePeriod({ paperwork: { completedLoads: 3, requiredTotal: 9, requiredPresent: 9 } }),
      'paperwork',
    );
    expect(g.grade).toBe('A');
    expect(g.reason).toMatch(/All required documents/);
  });
  it('drops as required docs go missing', () => {
    const g = cat(
      gradePeriod({ paperwork: { completedLoads: 4, requiredTotal: 12, requiredPresent: 7 } }),
      'paperwork',
    );
    expect(g.score).toBe(58);
    expect(g.reason).toMatch(/5 required documents missing/);
  });
  it('is ungradable with no completed loads', () => {
    expect(
      cat(
        gradePeriod({ paperwork: { completedLoads: 0, requiredTotal: 0, requiredPresent: 0 } }),
        'paperwork',
      ).gradable,
    ).toBe(false);
  });
});

describe('money owed grade', () => {
  it('is an A with nothing outstanding', () => {
    const g = cat(
      gradePeriod({
        moneyOwed: {
          receivableCount: 2,
          totalExpected: 500,
          outstanding: 0,
          overdue: 0,
          oldestOverdueDays: 0,
        },
      }),
      'money_owed',
    );
    expect(g.grade).toBe('A');
  });
  it('does not treat a fresh small balance as failing', () => {
    const g = cat(
      gradePeriod({
        moneyOwed: {
          receivableCount: 1,
          totalExpected: 200,
          outstanding: 200,
          overdue: 0,
          oldestOverdueDays: 0,
        },
      }),
      'money_owed',
    );
    expect(g.score).toBeGreaterThanOrEqual(80); // fresh → B or better
  });
  it('penalizes overdue, aged balances', () => {
    const g = cat(
      gradePeriod({
        moneyOwed: {
          receivableCount: 3,
          totalExpected: 640,
          outstanding: 640,
          overdue: 280,
          oldestOverdueDays: 40,
        },
      }),
      'money_owed',
    );
    expect(g.grade).toBe('D');
    expect(g.reason).toMatch(/\$640 remains outstanding, including \$280 overdue/);
  });
  it('is ungradable when nothing is tracked', () => {
    expect(cat(gradePeriod({ moneyOwed: { receivableCount: 0 } }), 'money_owed').gradable).toBe(
      false,
    );
  });
});

describe('overall grade — honest missing data', () => {
  const full: GradeInputs = {
    rate: {
      achievedAllMileRpm: 2.55,
      targetAllMileRpm: 2.5,
      breakEvenAllMileRpm: 2.0,
      loadsCounted: 5,
    },
    fuel: { expectedFuelCost: 1000, actualFuelCost: 940, businessMiles: 2000, mpg: 6.5 },
    deadhead: { deadheadMiles: 180, totalMiles: 1000 },
    paperwork: { completedLoads: 3, requiredTotal: 9, requiredPresent: 9 },
    moneyOwed: {
      receivableCount: 3,
      totalExpected: 640,
      outstanding: 640,
      overdue: 280,
      oldestOverdueDays: 40,
    },
  };

  it('never returns a letter for an all-empty period', () => {
    const g = gradePeriod({});
    expect(g.letter).toBeNull();
    expect(g.score).toBeNull();
    expect(g.gradableCount).toBe(0);
    expect(g.summary).toBe('Not enough data to grade this period yet.');
    // Every category is ungradable — none is an F or a 0.
    expect(g.categories.every((c) => !c.gradable && c.score === null && c.grade === null)).toBe(
      true,
    );
  });

  it('withholds the overall letter below the minimum gradable count', () => {
    const g = gradePeriod({ rate: full.rate, deadhead: full.deadhead });
    expect(g.gradableCount).toBe(2);
    expect(g.gradableCount).toBeLessThan(MIN_GRADABLE_FOR_OVERALL);
    expect(g.letter).toBeNull();
    expect(g.missing.length).toBe(3);
  });

  it('grades from only the gradable categories and reweights', () => {
    const g = gradePeriod({ rate: full.rate, fuel: full.fuel, deadhead: full.deadhead });
    expect(g.gradableCount).toBe(3);
    expect(g.letter).not.toBeNull();
    expect(g.summary).toBe('Based on 3 of 5 categories');
    // Average of exactly the three gradable scores.
    const scores = ['rate', 'fuel', 'deadhead'].map((c) => cat(g, c).score as number);
    expect(g.score).toBe(Math.round(scores.reduce((a, b) => a + b, 0) / 3));
  });

  it('grades all five when everything is present', () => {
    const g = gradePeriod(full);
    expect(g.gradableCount).toBe(5);
    expect(g.missing).toEqual([]);
    expect(g.summary).toBe('Based on 5 of 5 categories');
    expect(g.letter).not.toBeNull();
  });

  it('a missing category never drags the overall to F', () => {
    const g = gradePeriod({
      rate: full.rate,
      fuel: full.fuel,
      deadhead: full.deadhead,
      paperwork: full.paperwork,
    });
    expect(g.letter).not.toBe('F');
  });
});
