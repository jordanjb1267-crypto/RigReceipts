/**
 * Weekly/monthly operating grades (Master Loop 10 — "coached, not shamed").
 *
 * Five categories a driver controls: rate, fuel, deadhead, paperwork, money
 * owed. Each returns a rich, honest result — a letter, a 0–100 score, whether
 * it is `gradable` at all, a confidence, and a plain-English reason (either the
 * operational takeaway, or exactly what data is missing).
 *
 * Core rule: **missing data is never a failing grade.** An ungradable category
 * returns `gradable: false` with `score: null` and `grade: null` — never an F or
 * a zero. The overall grade is averaged only across genuinely gradable
 * categories, and if fewer than {@link MIN_GRADABLE_FOR_OVERALL} are gradable
 * we refuse to show a letter at all and say what to add instead.
 *
 * This module does not compute rate/RPM from scratch — the rate inputs come
 * from the existing Rate Check / RPM Coach engine (see `gradeInputs.ts`, which
 * reuses `analyzeRateCheck` and `estimateAllMileTargets`).
 */

export const GRADE_CATEGORIES = ['rate', 'fuel', 'deadhead', 'paperwork', 'money_owed'] as const;
export type GradeCategory = (typeof GRADE_CATEGORIES)[number];

export type LetterGrade = 'A' | 'B' | 'C' | 'D' | 'F';
export type GradeConfidence = 'high' | 'medium' | 'insufficient_data';

/** At least this many categories must be gradable before an overall letter shows. */
export const MIN_GRADABLE_FOR_OVERALL = 3;

export interface CategoryGrade {
  category: GradeCategory;
  /** 0–100, or null when not gradable. */
  score: number | null;
  grade: LetterGrade | null;
  gradable: boolean;
  confidence: GradeConfidence;
  /** Operational takeaway when graded; what's missing when not. */
  reason: string;
}

// --- Per-category inputs (all optional; absence → ungradable) ----------------

export interface RateGradeInput {
  /** Revenue ÷ total (loaded + deadhead) miles across counted loads. */
  achievedAllMileRpm?: number;
  /** Driver's target all-mile RPM (from RPM Coach / estimateAllMileTargets). */
  targetAllMileRpm?: number;
  /** Driver's break-even all-mile RPM. */
  breakEvenAllMileRpm?: number;
  /** How many loads contributed (drives confidence; 0 → ungradable). */
  loadsCounted?: number;
}

export interface FuelGradeInput {
  /** Price-adjusted expectation: businessMiles / mpg × applicable fuel price. */
  expectedFuelCost?: number;
  /** Actual fuel spend for the period. */
  actualFuelCost?: number;
  businessMiles?: number;
  mpg?: number;
}

export interface DeadheadGradeInput {
  deadheadMiles?: number;
  totalMiles?: number;
}

export interface PaperworkGradeInput {
  completedLoads?: number;
  /** Required documents expected across completed loads. */
  requiredTotal?: number;
  /** Required documents actually captured. */
  requiredPresent?: number;
}

export interface MoneyOwedGradeInput {
  /** Number of receivable records in the period (0/undefined → ungradable). */
  receivableCount?: number;
  /** Sum of expected amounts. */
  totalExpected?: number;
  /** Unresolved balance (expected − received) on non-terminal items. */
  outstanding?: number;
  /** Portion of `outstanding` that is overdue (>30 days / status overdue). */
  overdue?: number;
  /** Age in days of the oldest overdue item. */
  oldestOverdueDays?: number;
}

export interface GradeInputs {
  rate?: RateGradeInput;
  fuel?: FuelGradeInput;
  deadhead?: DeadheadGradeInput;
  paperwork?: PaperworkGradeInput;
  moneyOwed?: MoneyOwedGradeInput;
  /** Optional per-category override for the "why unavailable" reason. */
  reasons?: Partial<Record<GradeCategory, string>>;
}

export interface PeriodGrade {
  letter: LetterGrade | null;
  score: number | null;
  gradableCount: number;
  totalCategories: number;
  categories: CategoryGrade[];
  /** Reasons for each ungradable category (what to add). */
  missing: string[];
  /** "Based on N of 5 categories", or the not-enough-data message. */
  summary: string;
}

// --- helpers -----------------------------------------------------------------

const clamp100 = (n: number): number => Math.max(0, Math.min(100, Math.round(n)));
const rpm = (n: number): string => `$${n.toFixed(2)}`;
const money = (n: number): string => `$${Math.round(n).toLocaleString()}`;
const pct = (n: number): string => `${Math.round(n * 100)}%`;

/** Standard band: 90+ A, 80+ B, 70+ C, 60+ D, else F. */
export function letterFor(score: number): LetterGrade {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  return 'F';
}

const DEFAULT_REASONS: Record<GradeCategory, string> = {
  rate: 'Add revenue and miles to your loads to grade your rate.',
  fuel: 'Set your truck MPG and log fuel purchases to grade fuel.',
  deadhead: 'Track loaded and deadhead miles to grade deadhead.',
  paperwork: 'Deliver loads and attach their paperwork to grade it.',
  money_owed: 'Track detention, lumper, and reimbursements to grade money owed.',
};

function ungradable(category: GradeCategory, reasons: GradeInputs['reasons']): CategoryGrade {
  return {
    category,
    score: null,
    grade: null,
    gradable: false,
    confidence: 'insufficient_data',
    reason: reasons?.[category] ?? DEFAULT_REASONS[category],
  };
}

// --- Rate --------------------------------------------------------------------

/**
 * Anchors: at target → 82 (solid B); comfortably above target → A; below target
 * but above break-even → C then D as it approaches break-even; below break-even
 * → F. Never returns F for a merely "below target but profitable" load.
 */
function scoreRate(achieved: number, target: number, breakEven: number): number {
  if (achieved >= target) return clamp100(82 + (achieved / target - 1) * 160);
  if (target > breakEven && achieved >= breakEven) {
    const t = (achieved - breakEven) / (target - breakEven);
    return clamp100(60 + t * 22);
  }
  if (achieved >= breakEven) return 82; // degenerate target ≤ break-even
  return clamp100(Math.min(59, (achieved / breakEven) * 60));
}

function gradeRate(i: RateGradeInput | undefined, reasons: GradeInputs['reasons']): CategoryGrade {
  if (
    !i ||
    i.achievedAllMileRpm === undefined ||
    i.targetAllMileRpm === undefined ||
    i.breakEvenAllMileRpm === undefined ||
    i.targetAllMileRpm <= 0 ||
    i.breakEvenAllMileRpm <= 0 ||
    (i.loadsCounted ?? 0) <= 0
  ) {
    return ungradable('rate', reasons);
  }
  const a = i.achievedAllMileRpm;
  const t = i.targetAllMileRpm;
  const be = i.breakEvenAllMileRpm;
  const score = clamp100(scoreRate(a, t, be));
  const diff = a - t;
  const reason =
    a < be
      ? `Your average all-mile RPM (${rpm(a)}) came in under your ${rpm(be)} break-even.`
      : diff >= 0
        ? `Your average all-mile RPM (${rpm(a)}) finished ${rpm(diff)} above your ${rpm(t)} target.`
        : `Your average all-mile RPM (${rpm(a)}) was profitable but finished ${rpm(-diff)} below your ${rpm(t)} target.`;
  return {
    category: 'rate',
    score,
    grade: letterFor(score),
    gradable: true,
    confidence: (i.loadsCounted ?? 0) >= 3 ? 'high' : 'medium',
    reason,
  };
}

// --- Fuel --------------------------------------------------------------------

/** At expected → 75 (C); below expected → higher; above → lower (price-adjusted). */
function scoreFuel(expected: number, actual: number): number {
  const ratio = actual / expected;
  return clamp100(75 - (ratio - 1) * 250);
}

function gradeFuel(i: FuelGradeInput | undefined, reasons: GradeInputs['reasons']): CategoryGrade {
  if (
    !i ||
    i.expectedFuelCost === undefined ||
    i.actualFuelCost === undefined ||
    i.expectedFuelCost <= 0 ||
    i.actualFuelCost <= 0 ||
    (i.businessMiles ?? 0) <= 0 ||
    (i.mpg ?? 0) <= 0
  ) {
    return ungradable('fuel', reasons);
  }
  const ratio = i.actualFuelCost / i.expectedFuelCost;
  const score = clamp100(scoreFuel(i.expectedFuelCost, i.actualFuelCost));
  const reason =
    ratio <= 1
      ? `Fuel spending finished ${pct(1 - ratio)} below the expected cost for your recorded miles.`
      : `Fuel ran ${pct(ratio - 1)} above the expected cost for your recorded miles.`;
  return {
    category: 'fuel',
    score,
    grade: letterFor(score),
    gradable: true,
    confidence: 'high',
    reason,
  };
}

// --- Deadhead ----------------------------------------------------------------

function gradeDeadhead(
  i: DeadheadGradeInput | undefined,
  reasons: GradeInputs['reasons'],
): CategoryGrade {
  if (!i || i.totalMiles === undefined || i.totalMiles <= 0 || i.deadheadMiles === undefined) {
    return ungradable('deadhead', reasons);
  }
  const share = Math.max(0, i.deadheadMiles) / i.totalMiles;
  // 0% deadhead = 100; 25%+ ≈ 0.
  const score = clamp100(100 - share * 400);
  return {
    category: 'deadhead',
    score,
    grade: letterFor(score),
    gradable: true,
    confidence: 'high',
    reason: `${pct(share)} of your recorded business miles ran empty.`,
  };
}

// --- Paperwork ---------------------------------------------------------------

function gradePaperwork(
  i: PaperworkGradeInput | undefined,
  reasons: GradeInputs['reasons'],
): CategoryGrade {
  if (
    !i ||
    i.completedLoads === undefined ||
    i.completedLoads <= 0 ||
    i.requiredTotal === undefined ||
    i.requiredTotal <= 0 ||
    i.requiredPresent === undefined
  ) {
    return ungradable('paperwork', reasons);
  }
  const ratio = Math.max(0, Math.min(1, i.requiredPresent / i.requiredTotal));
  const score = clamp100(ratio * 100);
  const missing = i.requiredTotal - Math.min(i.requiredTotal, i.requiredPresent);
  const reason =
    missing === 0
      ? 'All required documents were captured for completed loads.'
      : `${missing} required document${missing === 1 ? '' : 's'} missing across completed loads.`;
  return {
    category: 'paperwork',
    score,
    grade: letterFor(score),
    gradable: true,
    confidence: 'high',
    reason,
  };
}

// --- Money owed --------------------------------------------------------------

function scoreMoneyOwed(m: Required<Omit<MoneyOwedGradeInput, 'receivableCount'>>): number {
  if (m.outstanding <= 0) return 100;
  const base = Math.max(m.totalExpected, m.outstanding, 1);
  const freshPenalty = Math.min(10, (m.outstanding / base) * 10);
  const overduePenalty = (m.overdue / base) * 40;
  const agingPenalty = Math.min(20, Math.floor(m.oldestOverdueDays / 30) * 8);
  return clamp100(100 - freshPenalty - overduePenalty - agingPenalty);
}

function gradeMoneyOwed(
  i: MoneyOwedGradeInput | undefined,
  reasons: GradeInputs['reasons'],
): CategoryGrade {
  if (!i || i.receivableCount === undefined || i.receivableCount <= 0) {
    return ungradable('money_owed', reasons);
  }
  const outstanding = Math.max(0, i.outstanding ?? 0);
  const overdue = Math.max(0, i.overdue ?? 0);
  const score = scoreMoneyOwed({
    totalExpected: Math.max(0, i.totalExpected ?? 0),
    outstanding,
    overdue,
    oldestOverdueDays: Math.max(0, i.oldestOverdueDays ?? 0),
  });
  const reason =
    outstanding <= 0
      ? 'No money left on the table — everything owed has been collected.'
      : `${money(outstanding)} remains outstanding${overdue > 0 ? `, including ${money(overdue)} overdue more than 30 days` : ''}.`;
  return {
    category: 'money_owed',
    score,
    grade: letterFor(score),
    gradable: true,
    confidence: 'high',
    reason,
  };
}

// --- Overall -----------------------------------------------------------------

/** Grades all five categories and computes the overall letter honestly. */
export function gradePeriod(inputs: GradeInputs): PeriodGrade {
  const { reasons } = inputs;
  const categories: CategoryGrade[] = [
    gradeRate(inputs.rate, reasons),
    gradeFuel(inputs.fuel, reasons),
    gradeDeadhead(inputs.deadhead, reasons),
    gradePaperwork(inputs.paperwork, reasons),
    gradeMoneyOwed(inputs.moneyOwed, reasons),
  ];
  const gradable = categories.filter(
    (c): c is CategoryGrade & { score: number } => c.gradable && c.score !== null,
  );
  const missing = categories.filter((c) => !c.gradable).map((c) => c.reason);

  if (gradable.length < MIN_GRADABLE_FOR_OVERALL) {
    return {
      letter: null,
      score: null,
      gradableCount: gradable.length,
      totalCategories: categories.length,
      categories,
      missing,
      summary: 'Not enough data to grade this period yet.',
    };
  }

  const score = Math.round(gradable.reduce((sum, c) => sum + c.score, 0) / gradable.length);
  return {
    letter: letterFor(score),
    score,
    gradableCount: gradable.length,
    totalCategories: categories.length,
    categories,
    missing,
    summary: `Based on ${gradable.length} of ${categories.length} categories`,
  };
}

export const CATEGORY_LABEL: Record<GradeCategory, string> = {
  rate: 'Rate',
  fuel: 'Fuel',
  deadhead: 'Deadhead',
  paperwork: 'Paperwork',
  money_owed: 'Money Owed',
};
