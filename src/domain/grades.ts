/**
 * Weekly/monthly operating grades (Master Loop 10 — "coached, not shamed").
 * Pure scoring over five categories a driver controls; each returns 0–100 and a
 * short coaching line. The overall grade is the weighted average mapped to a
 * letter. All inputs are optional so a partial week still grades what it can.
 */

export const GRADE_CATEGORIES = ['rate', 'fuel', 'deadhead', 'paperwork', 'money_owed'] as const;
export type GradeCategory = (typeof GRADE_CATEGORIES)[number];

export type LetterGrade = 'A' | 'B' | 'C' | 'D' | 'F';

export interface GradeInputs {
  /** Average all-mile RPM achieved vs the driver's target all-mile RPM. */
  achievedAllMileRpm?: number;
  targetAllMileRpm?: number;
  /** Actual fuel cost per mile vs the planned/variable fuel budget per mile. */
  fuelCostPerMile?: number;
  budgetFuelCostPerMile?: number;
  /** Deadhead and total miles for the period. */
  deadheadMiles?: number;
  totalMiles?: number;
  /** Loads delivered vs loads with complete paperwork (rate con + BOL/POD). */
  loadsDelivered?: number;
  loadsWithCompletePaperwork?: number;
  /** Count and age of unpaid money owed (detention, lumper, reimbursements). */
  openMoneyOwedCount?: number;
  oldestMoneyOwedDays?: number;
}

export interface CategoryGrade {
  category: GradeCategory;
  /** 0–100, or null when there isn't enough data to score this category. */
  score: number | null;
  note: string;
}

export interface PeriodGrade {
  letter: LetterGrade | null;
  score: number | null;
  categories: CategoryGrade[];
}

const clamp100 = (n: number): number => Math.max(0, Math.min(100, Math.round(n)));

/** Standard band: 90+ A, 80+ B, 70+ C, 60+ D, else F. */
export function letterFor(score: number): LetterGrade {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  return 'F';
}

function gradeRate(i: GradeInputs): CategoryGrade {
  if (!i.achievedAllMileRpm || !i.targetAllMileRpm || i.targetAllMileRpm <= 0) {
    return { category: 'rate', score: null, note: 'Run Rate Checks to grade your rate.' };
  }
  // 100 at target; ±: every 10% off target moves ~25 points.
  const ratio = i.achievedAllMileRpm / i.targetAllMileRpm;
  const score = clamp100(100 + (ratio - 1) * 250);
  const note =
    ratio >= 1
      ? 'At or above your target all-mile RPM. Keep holding the line.'
      : `About ${Math.round((1 - ratio) * 100)}% under target — watch the loads you accept.`;
  return { category: 'rate', score, note };
}

function gradeFuel(i: GradeInputs): CategoryGrade {
  if (!i.fuelCostPerMile || !i.budgetFuelCostPerMile || i.budgetFuelCostPerMile <= 0) {
    return { category: 'fuel', score: null, note: 'Log fuel to grade cost per mile.' };
  }
  // At budget = 100; every 10% over budget removes ~30 points.
  const over = i.fuelCostPerMile / i.budgetFuelCostPerMile - 1;
  const score = clamp100(100 - over * 300);
  const note =
    over <= 0
      ? 'Fuel cost per mile is on or under budget.'
      : `Fuel is ${Math.round(over * 100)}% over budget — fuel-stop planning helps.`;
  return { category: 'fuel', score, note };
}

function gradeDeadhead(i: GradeInputs): CategoryGrade {
  if (i.totalMiles === undefined || i.totalMiles <= 0 || i.deadheadMiles === undefined) {
    return { category: 'deadhead', score: null, note: 'Track miles to grade deadhead.' };
  }
  const pct = i.deadheadMiles / i.totalMiles;
  // 0% deadhead = 100; 25%+ deadhead ≈ 0.
  const score = clamp100(100 - pct * 400);
  const note = `${Math.round(pct * 100)}% of your miles ran empty.`;
  return { category: 'deadhead', score, note };
}

function gradePaperwork(i: GradeInputs): CategoryGrade {
  if (!i.loadsDelivered || i.loadsDelivered <= 0 || i.loadsWithCompletePaperwork === undefined) {
    return { category: 'paperwork', score: null, note: 'Deliver loads to grade paperwork.' };
  }
  const ratio = Math.min(1, i.loadsWithCompletePaperwork / i.loadsDelivered);
  const score = clamp100(ratio * 100);
  const missing = i.loadsDelivered - Math.min(i.loadsDelivered, i.loadsWithCompletePaperwork);
  const note =
    missing === 0
      ? 'Every delivered load has its paperwork. That is money protected.'
      : `${missing} load(s) missing rate con, BOL, or POD.`;
  return { category: 'paperwork', score, note };
}

function gradeMoneyOwed(i: GradeInputs): CategoryGrade {
  if (i.openMoneyOwedCount === undefined) {
    return { category: 'money_owed', score: null, note: 'Track detention and lumper to grade.' };
  }
  if (i.openMoneyOwedCount === 0) {
    return { category: 'money_owed', score: 100, note: 'No money left on the table. Clean.' };
  }
  const age = i.oldestMoneyOwedDays ?? 0;
  // Each open item −12, each week of age on the oldest −10.
  const score = clamp100(100 - i.openMoneyOwedCount * 12 - Math.floor(age / 7) * 10);
  return {
    category: 'money_owed',
    score,
    note: `${i.openMoneyOwedCount} open item(s)${age ? `, oldest ${age} days` : ''} — chase it.`,
  };
}

/** Grades all five categories and computes the overall letter from what scored. */
export function gradePeriod(inputs: GradeInputs): PeriodGrade {
  const categories = [
    gradeRate(inputs),
    gradeFuel(inputs),
    gradeDeadhead(inputs),
    gradePaperwork(inputs),
    gradeMoneyOwed(inputs),
  ];
  const scored = categories.filter((c) => c.score !== null) as (CategoryGrade & {
    score: number;
  })[];
  if (scored.length === 0) {
    return { letter: null, score: null, categories };
  }
  const avg = scored.reduce((sum, c) => sum + c.score, 0) / scored.length;
  const score = Math.round(avg);
  return { letter: letterFor(score), score, categories };
}
