/**
 * Load Economics Packet — derived view of one load as the primary real-world
 * object. Values are omitted (null) when the underlying field was never
 * entered. Nothing here is FreightOS runtime state.
 *
 * Mileage distinctions:
 *   actual GPS miles  !=  planned/estimated route miles  !=  paid miles
 * Routing estimates, if added later, must stay provider-identified.
 */

import {
  ActionItem,
  actionItemsForLoad,
  ActionLoad,
  DeriveActionItemsInput,
  deriveActionItems,
} from './actionItems';
import { presentDocTypesForLoad } from './documents';
import { AllMileTargets } from './freight';
import { deriveLoadRate, LoadRateComputation } from './gradeInputs';
import { emptyLoadIntegrationSeams, LoadIntegrationSeams } from './integrationSeams';
import {
  LoadDocumentReconciliation,
  LoadPaperworkCapture,
  LoadPaperworkSlot,
  missingRequiredDocTypes,
  reconcileLoadDocuments,
} from './loadDocuments';
import { isCompletedLoad, LoadRateStatus, LoadStatus } from './loads';
import { LoadMileage, loadMileage, MileageSegment } from './mileageSession';
import { receivableOutstanding } from './receivables';

export interface PlannedMiles {
  loadedMiles: number | null;
  deadheadMiles: number | null;
  /** Null unless loaded miles were entered. Deadhead defaults to 0 only then. */
  totalMiles: number | null;
}

export interface RouteEstimateMiles {
  providerKind: string;
  miles: number;
}

export interface LoadEconomicsPacket {
  loadId: string;
  loadNumber: string;
  origin: string | null;
  destination: string | null;
  broker: string | null;
  status: LoadStatus;
  completed: boolean;
  grossRate: number | null;
  fuelSurcharge: number | null;
  revenue: number | null;
  allMileRpm: number | null;
  loadedRpm: number | null;
  rateStatus: LoadRateStatus;
  estimatedContribution: number | null;
  plannedMiles: PlannedMiles;
  /** Live Mileage actuals; null when no segments are attributed to the load. */
  actualLiveMileage: LoadMileage | null;
  /** Not modeled in this product. Always null. */
  paidMiles: null;
  /** Provider-identified routing estimate. Always null until a provider exists. */
  routeEstimate: RouteEstimateMiles | null;
  documentsRemaining: ReturnType<typeof missingRequiredDocTypes>;
  documentsRemainingCount: number;
  actionsRemaining: number;
  outstandingReceivableUsd: number | null;
  primaryAction: ActionItem | null;
  paperwork: LoadDocumentReconciliation;
  rate: LoadRateComputation;
  integrationSeams: LoadIntegrationSeams;
  localComplete: boolean;
  /** Always false — this packet never asserts external delivery. */
  externallyDelivered: false;
  /** Always false — this packet never asserts recipient acceptance. */
  recipientAccepted: false;
}

export interface PacketLoad extends ActionLoad {
  broker: string | null;
  fuelSurcharge: number | null;
  deadheadMiles: number | null;
}

export interface LoadEconomicsPacketInput {
  load: PacketLoad;
  docs: DeriveActionItemsInput['docs'];
  captures: DeriveActionItemsInput['captures'];
  slots: readonly LoadPaperworkSlot[];
  captureRecords: readonly LoadPaperworkCapture[];
  receivables: DeriveActionItemsInput['receivables'];
  segments: readonly MileageSegment[];
  targets: AllMileTargets | null;
  variableCostPerMile?: number;
  actionItems?: readonly ActionItem[];
}

export function plannedMilesFromLoad(load: {
  loadedMiles: number | null;
  deadheadMiles: number | null;
}): PlannedMiles {
  const loadedMiles = load.loadedMiles;
  const deadheadMiles = load.deadheadMiles;
  const totalMiles = loadedMiles === null ? null : loadedMiles + (deadheadMiles ?? 0);
  return { loadedMiles, deadheadMiles, totalMiles };
}

export function actualLiveMileageForLoad(
  segments: readonly MileageSegment[],
  loadId: string,
): LoadMileage | null {
  if (!segments.some((s) => s.loadId === loadId)) return null;
  return loadMileage(segments, loadId);
}

export function buildLoadEconomicsPacket(input: LoadEconomicsPacketInput): LoadEconomicsPacket {
  const { load } = input;
  const presentDocTypes = presentDocTypesForLoad(load.id, input.docs, input.captures);
  const rate = deriveLoadRate(
    {
      grossRate: load.grossRate,
      fuelSurcharge: load.fuelSurcharge,
      loadedMiles: load.loadedMiles,
      deadheadMiles: load.deadheadMiles,
      completed: isCompletedLoad(load.status),
      bolRequired: load.bolRequired,
      presentDocTypes,
    },
    input.targets,
    input.variableCostPerMile,
  );

  const actions =
    input.actionItems ??
    deriveActionItems({
      loads: [load],
      docs: input.docs,
      captures: input.captures,
      receivables: input.receivables,
      segments: input.segments,
    });
  const loadActions = actionItemsForLoad(actions, load.id);
  const documentsRemaining = missingRequiredDocTypes(
    load.id,
    load.bolRequired,
    input.docs,
    input.captures,
  );
  const loadReceivables = input.receivables.filter((r) => r.loadId === load.id);
  const outstanding = loadReceivables.reduce((sum, r) => sum + receivableOutstanding(r), 0);

  const paperwork = reconcileLoadDocuments({
    loadId: load.id,
    bolRequired: load.bolRequired,
    slots: input.slots,
    captures: input.captureRecords,
  });

  const localComplete =
    isCompletedLoad(load.status) &&
    documentsRemaining.length === 0 &&
    load.grossRate !== null &&
    load.loadedMiles !== null;

  return {
    loadId: load.id,
    loadNumber: load.loadNumber,
    origin: load.origin,
    destination: load.destination,
    broker: load.broker,
    status: load.status,
    completed: isCompletedLoad(load.status),
    grossRate: load.grossRate,
    fuelSurcharge: load.fuelSurcharge,
    revenue: rate.revenue,
    allMileRpm: rate.allMileRpm,
    loadedRpm: rate.loadedRpm,
    rateStatus: rate.rateStatus,
    estimatedContribution: rate.estimatedContribution,
    plannedMiles: plannedMilesFromLoad(load),
    actualLiveMileage: actualLiveMileageForLoad(input.segments, load.id),
    paidMiles: null,
    routeEstimate: null,
    documentsRemaining,
    documentsRemainingCount: documentsRemaining.length,
    actionsRemaining: loadActions.length,
    outstandingReceivableUsd: loadReceivables.length === 0 ? null : outstanding,
    primaryAction: loadActions[0] ?? null,
    paperwork,
    rate,
    integrationSeams: emptyLoadIntegrationSeams(),
    localComplete,
    externallyDelivered: false,
    recipientAccepted: false,
  };
}
