import { DocumentType } from '../documents';
import { estimateAllMileTargets } from '../freight';
import {
  assembleGradeInputs,
  buildMoneyOwedInput,
  buildPaperworkInput,
  deriveLoadRate,
  expectedFuelCost,
  GradableLoad,
  loadRevenue,
} from '../gradeInputs';
import { gradePeriod } from '../grades';

const targets = estimateAllMileTargets({
  fixedWeeklyCosts: 1100,
  variableCostPerMile: 1.05,
  projectedTotalMiles: 2600,
  desiredDriverPay: 1400,
  desiredProfitReserve: 400,
})!;

const load = (over: Partial<GradableLoad>): GradableLoad => ({
  grossRate: 2000,
  fuelSurcharge: 0,
  loadedMiles: 900,
  deadheadMiles: 100,
  completed: true,
  bolRequired: true,
  presentDocTypes: [],
  ...over,
});

describe('loadRevenue', () => {
  it('adds fuel surcharge to gross rate', () => {
    expect(loadRevenue({ grossRate: 1800, fuelSurcharge: 200 })).toBe(2000);
  });
  it('is null without a gross rate', () => {
    expect(loadRevenue({ grossRate: null, fuelSurcharge: 100 })).toBeNull();
  });
});

describe('deriveLoadRate', () => {
  it('computes RPMs and a rate status against targets', () => {
    const c = deriveLoadRate(
      load({ grossRate: 2600, loadedMiles: 900, deadheadMiles: 100 }),
      targets,
      1.05,
    );
    expect(c.totalMiles).toBe(1000);
    expect(c.loadedRpm).toBeCloseTo(2.89, 2);
    expect(c.allMileRpm).toBe(2.6);
    expect(['above_target', 'on_target', 'below_target', 'below_break_even']).toContain(
      c.rateStatus,
    );
    expect(c.estimatedTripCost).toBe(1050);
    expect(c.estimatedContribution).toBe(1550);
  });

  it('stays unknown when revenue or miles are missing', () => {
    expect(deriveLoadRate(load({ grossRate: null }), targets).rateStatus).toBe('unknown');
    expect(deriveLoadRate(load({ loadedMiles: null }), targets).rateStatus).toBe('unknown');
  });

  it('stays unknown without cost targets, but still reports RPMs', () => {
    const c = deriveLoadRate(load({ grossRate: 2600 }), null);
    expect(c.rateStatus).toBe('unknown');
    expect(c.allMileRpm).toBe(2.6);
  });
});

describe('expectedFuelCost', () => {
  it('is miles / mpg × price', () => {
    expect(expectedFuelCost(2000, 6.5, 3.9)).toBe(1200);
  });
  it('is null with missing inputs', () => {
    expect(expectedFuelCost(0, 6.5, 3.9)).toBeNull();
    expect(expectedFuelCost(2000, 0, 3.9)).toBeNull();
  });
});

describe('buildPaperworkInput', () => {
  it('counts required docs present across completed loads', () => {
    const present: DocumentType[] = ['rate_confirmation', 'pod'];
    const p = buildPaperworkInput([
      load({ completed: true, bolRequired: true, presentDocTypes: present }), // 2 of 3
      load({ completed: true, bolRequired: false, presentDocTypes: ['rate_confirmation', 'pod'] }), // 2 of 2
      load({ completed: false, presentDocTypes: [] }), // not completed → ignored
    ]);
    expect(p.completedLoads).toBe(2);
    expect(p.requiredTotal).toBe(5);
    expect(p.requiredPresent).toBe(4);
  });
  it('reports no completed loads', () => {
    expect(buildPaperworkInput([load({ completed: false })]).completedLoads).toBe(0);
  });
});

describe('buildMoneyOwedInput', () => {
  it('sums outstanding and overdue, ignoring terminal items', () => {
    const m = buildMoneyOwedInput([
      { amountExpected: 300, amountReceived: 0, status: 'overdue', ageDays: 45 },
      { amountExpected: 200, amountReceived: 0, status: 'submitted', ageDays: 5 }, // fresh
      { amountExpected: 500, amountReceived: 500, status: 'paid', ageDays: 90 }, // terminal
    ]);
    expect(m.receivableCount).toBe(3);
    expect(m.outstanding).toBe(500);
    expect(m.overdue).toBe(300);
    expect(m.oldestOverdueDays).toBe(45);
  });
  it('reports nothing tracked', () => {
    expect(buildMoneyOwedInput([]).receivableCount).toBe(0);
  });
});

describe('assembleGradeInputs → gradePeriod', () => {
  it('produces a full, gradable period from complete data', () => {
    const inputs = assembleGradeInputs({
      loads: [
        load({
          grossRate: 2600,
          loadedMiles: 900,
          deadheadMiles: 100,
          completed: true,
          presentDocTypes: ['rate_confirmation', 'pod', 'bol'],
        }),
      ],
      targets,
      hasCostProfile: true,
      trips: { deadheadMiles: 180, totalMiles: 1000 },
      fuel: { businessMiles: 2000, mpg: 6.5, actualFuelCost: 1140, gallonsPurchased: 300 },
      receivables: [{ amountExpected: 275, amountReceived: 0, status: 'submitted', ageDays: 3 }],
    });
    const g = gradePeriod(inputs);
    expect(g.gradableCount).toBe(5);
    expect(g.letter).not.toBeNull();
  });

  it('attaches precise missing-data reasons and never fails', () => {
    const inputs = assembleGradeInputs({
      loads: [load({ grossRate: null, loadedMiles: null, completed: false, presentDocTypes: [] })],
      targets: null,
      hasCostProfile: false,
      trips: { deadheadMiles: 0, totalMiles: 0 },
      fuel: { businessMiles: 0, mpg: null, actualFuelCost: 0, gallonsPurchased: 0 },
      receivables: [],
    });
    const g = gradePeriod(inputs);
    expect(g.letter).toBeNull();
    expect(g.gradableCount).toBe(0);
    expect(inputs.reasons?.rate).toMatch(/RPM Coach/);
    expect(inputs.reasons?.fuel).toMatch(/MPG/);
    // No category became an F.
    expect(g.categories.every((c) => c.grade !== 'F')).toBe(true);
  });
});
