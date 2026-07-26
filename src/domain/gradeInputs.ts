/**
 * Assembles {@link GradeInputs} from the driver's own records, reusing the
 * existing Rate Check / RPM Coach engine (`analyzeRateCheck`,
 * `estimateAllMileTargets`) rather than recomputing rates. Pure and tested;
 * screens pass already-loaded store data in.
 *
 * Separation of miles: **load** miles feed the Rate grade (revenue ÷ load
 * miles); the **trip ledger** feeds Deadhead and Fuel business-miles, so the
 * same mile is never counted for two purposes.
 */

import { DocumentType, requiredDocsForLoad } from './documents';
import { analyzeRateCheck, AllMileTargets } from './freight';
import {
  DeadheadGradeInput,
  FuelGradeInput,
  GradeInputs,
  MoneyOwedGradeInput,
  PaperworkGradeInput,
  RateGradeInput,
} from './grades';
import { LoadRateStatus } from './loads';
import { isReceivableOverdue, isTerminalReceivable, ReceivableStatus } from './receivables';

const round2 = (n: number): number => Math.round(n * 100) / 100;

// --- Per-load rate derivation (reuses analyzeRateCheck) ----------------------

export interface GradableLoad {
  grossRate: number | null;
  fuelSurcharge: number | null;
  loadedMiles: number | null;
  deadheadMiles: number | null;
  /** delivered or paid — a completed load that should carry paperwork. */
  completed: boolean;
  bolRequired: boolean;
  /** Document types attached to the load and not `missing`. */
  presentDocTypes: DocumentType[];
}

export interface LoadRateComputation {
  revenue: number | null;
  totalMiles: number | null;
  loadedRpm: number | null;
  allMileRpm: number | null;
  rateStatus: LoadRateStatus;
  estimatedTripCost: number | null;
  estimatedContribution: number | null;
}

/** Gross rate + fuel surcharge = total revenue. Null when no gross rate. */
export function loadRevenue(l: Pick<GradableLoad, 'grossRate' | 'fuelSurcharge'>): number | null {
  if (l.grossRate === null || l.grossRate === undefined) return null;
  return round2(l.grossRate + (l.fuelSurcharge ?? 0));
}

/**
 * Derives a load's RPMs, rate status, and estimated cost/contribution. Rate
 * status stays `unknown` unless both revenue+miles and cost targets exist —
 * missing data is never turned into a verdict.
 */
export function deriveLoadRate(
  l: GradableLoad,
  targets: AllMileTargets | null,
  variableCostPerMile?: number,
): LoadRateComputation {
  const revenue = loadRevenue(l);
  const loaded = l.loadedMiles;
  if (revenue === null || loaded === null || loaded === undefined || loaded <= 0) {
    return {
      revenue,
      totalMiles: null,
      loadedRpm: null,
      allMileRpm: null,
      rateStatus: 'unknown',
      estimatedTripCost: null,
      estimatedContribution: null,
    };
  }
  const deadhead = Math.max(0, l.deadheadMiles ?? 0);
  const totalMiles = loaded + deadhead;
  const loadedRpm = round2(revenue / loaded);
  const allMileRpm = round2(revenue / totalMiles);

  let rateStatus: LoadRateStatus = 'unknown';
  if (targets) {
    rateStatus = analyzeRateCheck({
      offeredPay: revenue,
      loadedMiles: loaded,
      deadheadMiles: deadhead,
      breakEvenAllMileRpm: targets.breakEvenAllMileRpm,
      targetAllMileRpm: targets.targetAllMileRpm,
      variableCostPerMile,
    }).verdict;
  }

  const estimatedTripCost =
    variableCostPerMile !== undefined ? round2(variableCostPerMile * totalMiles) : null;
  const estimatedContribution =
    estimatedTripCost !== null ? round2(revenue - estimatedTripCost) : null;

  return {
    revenue,
    totalMiles,
    loadedRpm,
    allMileRpm,
    rateStatus,
    estimatedTripCost,
    estimatedContribution,
  };
}

// --- Category input builders -------------------------------------------------

export function buildRateInput(
  loads: readonly GradableLoad[],
  targets: AllMileTargets | null,
): RateGradeInput {
  if (!targets) return {};
  let totalRevenue = 0;
  let totalMiles = 0;
  let loadsCounted = 0;
  for (const l of loads) {
    const c = deriveLoadRate(l, targets);
    if (c.revenue !== null && c.totalMiles !== null) {
      totalRevenue += c.revenue;
      totalMiles += c.totalMiles;
      loadsCounted += 1;
    }
  }
  if (loadsCounted === 0 || totalMiles <= 0) return {};
  return {
    achievedAllMileRpm: round2(totalRevenue / totalMiles),
    targetAllMileRpm: targets.targetAllMileRpm,
    breakEvenAllMileRpm: targets.breakEvenAllMileRpm,
    loadsCounted,
  };
}

/** Price-adjusted fuel expectation: businessMiles / mpg × applicable price. */
export function expectedFuelCost(
  businessMiles: number,
  mpg: number,
  pricePerGallon: number,
): number | null {
  if (businessMiles <= 0 || mpg <= 0 || pricePerGallon <= 0) return null;
  return round2((businessMiles / mpg) * pricePerGallon);
}

export interface FuelSource {
  businessMiles: number;
  mpg: number | null;
  actualFuelCost: number;
  /** Gallons purchased in the period, to recover the price actually paid. */
  gallonsPurchased: number;
  /** Fallback diesel price when gallons aren't recorded. */
  dieselPricePerGallon?: number | null;
}

export function buildFuelInput(f: FuelSource): FuelGradeInput {
  const base: FuelGradeInput = {
    businessMiles: f.businessMiles,
    mpg: f.mpg ?? undefined,
    actualFuelCost: f.actualFuelCost,
  };
  if (!f.mpg || f.mpg <= 0 || f.businessMiles <= 0 || f.actualFuelCost <= 0) return base;
  // Price actually paid (price-adjusted expectation) if gallons are known, else fallback.
  const price =
    f.gallonsPurchased > 0 ? f.actualFuelCost / f.gallonsPurchased : (f.dieselPricePerGallon ?? 0);
  const expected = expectedFuelCost(f.businessMiles, f.mpg, price);
  if (expected === null) return base;
  return { ...base, expectedFuelCost: expected };
}

export function buildDeadheadInput(deadheadMiles: number, totalMiles: number): DeadheadGradeInput {
  return { deadheadMiles, totalMiles };
}

export function buildPaperworkInput(loads: readonly GradableLoad[]): PaperworkGradeInput {
  const completed = loads.filter((l) => l.completed);
  if (completed.length === 0) return { completedLoads: 0 };
  let requiredTotal = 0;
  let requiredPresent = 0;
  for (const l of completed) {
    const req = requiredDocsForLoad(l.bolRequired);
    requiredTotal += req.length;
    requiredPresent += req.filter((t) => l.presentDocTypes.includes(t)).length;
  }
  return { completedLoads: completed.length, requiredTotal, requiredPresent };
}

export interface GradableReceivable {
  amountExpected: number;
  amountReceived: number;
  status: ReceivableStatus;
  ageDays: number;
}

export function buildMoneyOwedInput(
  receivables: readonly GradableReceivable[],
): MoneyOwedGradeInput {
  if (receivables.length === 0) return { receivableCount: 0 };
  let totalExpected = 0;
  let outstanding = 0;
  let overdue = 0;
  let oldestOverdueDays = 0;
  for (const r of receivables) {
    totalExpected += r.amountExpected;
    if (isTerminalReceivable(r.status)) continue;
    const bal = Math.max(0, r.amountExpected - r.amountReceived);
    outstanding += bal;
    if (isReceivableOverdue(r, r.ageDays)) {
      overdue += bal;
      oldestOverdueDays = Math.max(oldestOverdueDays, r.ageDays);
    }
  }
  return {
    receivableCount: receivables.length,
    totalExpected: round2(totalExpected),
    outstanding: round2(outstanding),
    overdue: round2(overdue),
    oldestOverdueDays,
  };
}

// --- Top-level assembly ------------------------------------------------------

export interface AssembleArgs {
  loads: readonly GradableLoad[];
  targets: AllMileTargets | null;
  /** Whether the driver has saved a real cost profile (vs. no profile at all). */
  hasCostProfile: boolean;
  trips: { deadheadMiles: number; totalMiles: number };
  fuel: FuelSource;
  receivables: readonly GradableReceivable[];
}

/** Builds the full {@link GradeInputs}, with precise "what's missing" reasons. */
export function assembleGradeInputs(args: AssembleArgs): GradeInputs {
  const reasons: NonNullable<GradeInputs['reasons']> = {};

  const rate = buildRateInput(args.loads, args.targets);
  if (rate.achievedAllMileRpm === undefined) {
    reasons.rate = !args.hasCostProfile
      ? 'Set your costs in RPM Coach so we can grade your rate against your target.'
      : 'Add gross rate and loaded miles to your loads to grade your rate.';
  }

  const fuel = buildFuelInput(args.fuel);
  if (fuel.expectedFuelCost === undefined) {
    reasons.fuel =
      !args.fuel.mpg || args.fuel.mpg <= 0
        ? "Set your truck's average MPG to grade fuel."
        : args.fuel.businessMiles <= 0
          ? 'Track miles to grade fuel efficiency.'
          : 'Log fuel purchases to grade fuel.';
  }

  const deadhead = buildDeadheadInput(args.trips.deadheadMiles, args.trips.totalMiles);
  if (args.trips.totalMiles <= 0) reasons.deadhead = 'Track miles to grade deadhead.';

  const paperwork = buildPaperworkInput(args.loads);
  if (!paperwork.completedLoads) {
    reasons.paperwork = 'Deliver loads and attach their paperwork to grade it.';
  }

  const moneyOwed = buildMoneyOwedInput(args.receivables);
  if (!moneyOwed.receivableCount) {
    reasons.money_owed = 'Track detention, lumper, and reimbursements to grade money owed.';
  }

  return { rate, fuel, deadhead, paperwork, moneyOwed, reasons };
}
