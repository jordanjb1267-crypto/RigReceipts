/**
 * Non-production representative local state for product-surface QA.
 * Not accounts, not cloud rows, not production flags. The screens already
 * render these shapes via groupLoadsForList / deriveActionItems /
 * buildLoadEconomicsPacket / attachConfirmedCaptureToLoad.
 */

import type { ActionLoad, MileageSegment, PacketLoad } from '@/domain';

export const PRODUCT_QA_NOW_MS = Date.parse('2026-09-09T00:00:00.000Z');

const packet = (load: ActionLoad, extra: Partial<PacketLoad> = {}): PacketLoad => ({
  ...load,
  broker: extra.broker ?? 'Acme Broker',
  fuelSurcharge: extra.fuelSurcharge ?? null,
  deadheadMiles: extra.deadheadMiles ?? 40,
});

/** Scenario 1 — saved evaluated offer with economics present. */
export const QA_SAVED_OFFER: PacketLoad = packet({
  id: 'qa_saved',
  loadNumber: 'RC-1001',
  origin: 'Chicago, IL',
  destination: 'Dallas, TX',
  status: 'evaluated',
  grossRate: 2150,
  loadedMiles: 720,
  bolRequired: true,
});

/** Scenario 1b — evaluated offer missing gross (later action, still Saved). */
export const QA_SAVED_OFFER_NEEDS_GROSS: PacketLoad = packet({
  id: 'qa_saved_gross',
  loadNumber: 'RC-1002',
  origin: 'Kansas City, MO',
  destination: 'Denver, CO',
  status: 'evaluated',
  grossRate: null,
  loadedMiles: 600,
  bolRequired: true,
});

/** Scenario 2 — booked operational load with required paperwork present. */
export const QA_ACTIVE_BOOKED: PacketLoad = packet({
  id: 'qa_active',
  loadNumber: '48291',
  origin: 'Chicago, IL',
  destination: 'Atlanta, GA',
  status: 'booked',
  grossRate: 2150,
  loadedMiles: 720,
  bolRequired: true,
});

/** Scenario 3 — in transit, missing a required document. */
export const QA_NEEDS_ACTION_TRANSIT: PacketLoad = packet({
  id: 'qa_needs',
  loadNumber: '55102',
  origin: 'Dallas, TX',
  destination: 'Memphis, TN',
  status: 'in_transit',
  grossRate: 1480,
  loadedMiles: 452,
  bolRequired: true,
});

/** Scenario 4 — delivered, still operationally open. */
export const QA_DELIVERED: PacketLoad = packet({
  id: 'qa_delivered',
  loadNumber: '77011',
  origin: 'Atlanta, GA',
  destination: 'Jacksonville, FL',
  status: 'delivered',
  grossRate: 980,
  loadedMiles: 350,
  bolRequired: true,
});

/** Scenario 5 — paid / Closed. */
export const QA_CLOSED_PAID: PacketLoad = packet({
  id: 'qa_closed',
  loadNumber: '88020',
  origin: 'Nashville, TN',
  destination: 'Louisville, KY',
  status: 'paid',
  grossRate: 720,
  loadedMiles: 180,
  bolRequired: true,
});

export const QA_COMPLETE_DOCS = (loadId: string) =>
  [
    { loadId, docType: 'rate_confirmation' as const, status: 'captured' as const },
    { loadId, docType: 'pod' as const, status: 'captured' as const },
    { loadId, docType: 'bol' as const, status: 'captured' as const },
  ] as const;

export const QA_LIVE_SEGMENT = (loadId: string, miles: number): MileageSegment => ({
  id: `seg_${loadId}`,
  sessionId: 'sess_qa',
  loadId,
  startedAt: PRODUCT_QA_NOW_MS - 3_600_000,
  endedAt: PRODUCT_QA_NOW_MS - 1_800_000,
  startLocation: null,
  endLocation: null,
  calculatedMiles: miles,
  adjustedMiles: null,
  accountingCategory: 'loaded',
  businessSubtype: null,
  trailerConfiguration: 'loaded_trailer',
  classificationSource: 'user',
  classificationConfidence: null,
  userConfirmed: true,
  note: null,
  createdAt: PRODUCT_QA_NOW_MS,
  updatedAt: PRODUCT_QA_NOW_MS,
});

export const QA_ALL_LOADS: PacketLoad[] = [
  QA_SAVED_OFFER,
  QA_SAVED_OFFER_NEEDS_GROSS,
  QA_ACTIVE_BOOKED,
  QA_NEEDS_ACTION_TRANSIT,
  QA_DELIVERED,
  QA_CLOSED_PAID,
];
