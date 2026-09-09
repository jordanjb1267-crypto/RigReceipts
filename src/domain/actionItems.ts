/**
 * Derived Today / Needs Action items. Product state only — not a second
 * workflow database, not FreightOS Responsibility, not autonomous actions.
 *
 * Urgency is deterministic from existing domain fields. No model scores it.
 */

import { DocumentType, documentTypeLabel, ManualLoadDoc } from './documents';
import { missingRequiredDocTypes, scanTypeForDocumentType } from './loadDocuments';
import { isCompletedLoad, isOpenLoad, LoadStatus } from './loads';
import { MileageSegment, unclassifiedMiles } from './mileageSession';
import {
  isReceivableOverdue,
  isTerminalReceivable,
  ReceivableStatus,
  ReceivableType,
  receivableOutstanding,
  receivableTypeLabel,
} from './receivables';

export const ACTION_SOURCE_OBJECT_TYPES = [
  'load',
  'mileage',
  'receivable',
  'capture',
  'carrier_packet',
  'road_wallet',
] as const;
export type ActionSourceObjectType = (typeof ACTION_SOURCE_OBJECT_TYPES)[number];

export const ACTION_ITEM_KINDS = [
  'missing_document',
  'unclassified_mileage',
  'incomplete_economics',
  'receivable_attention',
  'closeout_incomplete',
  'carrier_packet',
  'road_wallet',
] as const;
export type ActionItemKind = (typeof ACTION_ITEM_KINDS)[number];

export const ACTION_URGENCIES = ['now', 'soon', 'later'] as const;
export type ActionUrgency = (typeof ACTION_URGENCIES)[number];

export interface ActionDeepLink {
  pathname: string;
  params?: Record<string, string>;
}

export interface ActionItem {
  id: string;
  sourceObjectType: ActionSourceObjectType;
  sourceObjectId: string;
  kind: ActionItemKind;
  urgency: ActionUrgency;
  title: string;
  context: string;
  deepLink: ActionDeepLink;
  reason: string;
}

export interface ActionLoad {
  id: string;
  loadNumber: string;
  origin: string | null;
  destination: string | null;
  status: LoadStatus;
  grossRate: number | null;
  loadedMiles: number | null;
  bolRequired: boolean;
}

export interface ActionReceivable {
  id: string;
  loadId: string | null;
  type: ReceivableType;
  status: ReceivableStatus;
  amountExpected: number;
  amountReceived: number;
  dateDue: string | null;
}

export interface ActionCapture {
  loadId?: string | null;
  scanType: string;
  intendedDocType?: DocumentType | null;
}

export interface ActionRoadWalletSnapshot {
  expired: number;
  expiringSoon: number;
}

export interface ActionPacketSnapshot {
  id: string;
  name: string;
  status: 'DRAFT' | 'READY' | 'SHARED' | 'SUPERSEDED';
}

export interface DeriveActionItemsInput {
  loads: readonly ActionLoad[];
  docs: readonly ManualLoadDoc[];
  captures: readonly ActionCapture[];
  receivables: readonly ActionReceivable[];
  segments: readonly MileageSegment[];
  /** Pass only when Road Wallet is enabled for this session. */
  roadWallet?: ActionRoadWalletSnapshot | null;
  /** Pass only when Carrier Packet builder is enabled for this session. */
  packets?: readonly ActionPacketSnapshot[] | null;
  nowMs?: number;
}

const URGENCY_RANK: Record<ActionUrgency, number> = { now: 0, soon: 1, later: 2 };

const routeLabel = (load: ActionLoad): string => {
  if (!load.origin && !load.destination) return `Load ${load.loadNumber}`;
  return `${load.origin ?? '—'} → ${load.destination ?? '—'}`;
};

const loadLink = (loadId: string): ActionDeepLink => ({
  pathname: '/load-detail',
  params: { id: loadId },
});

const scanLink = (loadId: string, docType: DocumentType, sourceAction: string): ActionDeepLink => ({
  pathname: '/(tabs)/scan',
  params: {
    loadId,
    scanType: scanTypeForDocumentType(docType),
    intendedDocType: docType,
    sourceAction,
  },
});

function missingDocUrgency(status: LoadStatus, docType: DocumentType): ActionUrgency | null {
  if (status === 'evaluated') return null;
  if (isCompletedLoad(status)) return 'now';
  if (status === 'in_transit') return 'soon';
  if (status === 'booked') return docType === 'rate_confirmation' ? 'soon' : 'later';
  return 'later';
}

function receivableAgeDays(r: ActionReceivable, nowMs: number): number {
  if (!r.dateDue) return 0;
  const due = Date.parse(r.dateDue);
  if (!Number.isFinite(due)) return 0;
  return Math.floor((nowMs - due) / 86_400_000);
}

export function sortActionItems(items: readonly ActionItem[]): ActionItem[] {
  return [...items].sort((a, b) => {
    const urgency = URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency];
    if (urgency !== 0) return urgency;
    if (a.kind !== b.kind) return a.kind.localeCompare(b.kind);
    return a.id.localeCompare(b.id);
  });
}

export function deriveActionItems(input: DeriveActionItemsInput): ActionItem[] {
  const nowMs = input.nowMs ?? 0;
  const items: ActionItem[] = [];

  for (const load of input.loads) {
    const missing = missingRequiredDocTypes(load.id, load.bolRequired, input.docs, input.captures);
    for (const docType of missing) {
      const urgency = missingDocUrgency(load.status, docType);
      if (!urgency) continue;
      items.push({
        id: `missing_document:load:${load.id}:${docType}`,
        sourceObjectType: 'load',
        sourceObjectId: load.id,
        kind: 'missing_document',
        urgency,
        title: `Scan ${documentTypeLabel(docType)}`,
        context: routeLabel(load),
        deepLink: scanLink(load.id, docType, 'missing_document'),
        reason: `Required ${documentTypeLabel(docType)} is not present on load ${load.loadNumber}. Local paperwork only.`,
      });
    }

    const needsEconomics =
      load.status === 'evaluated'
        ? load.grossRate === null
        : isOpenLoad(load.status) && (load.grossRate === null || load.loadedMiles === null);
    if (needsEconomics) {
      items.push({
        id: `incomplete_economics:load:${load.id}`,
        sourceObjectType: 'load',
        sourceObjectId: load.id,
        kind: 'incomplete_economics',
        urgency:
          load.status === 'evaluated' ? 'later' : isCompletedLoad(load.status) ? 'now' : 'soon',
        title: 'Finish load economics',
        context: routeLabel(load),
        deepLink: loadLink(load.id),
        reason:
          load.grossRate === null
            ? `Gross rate is not entered on load ${load.loadNumber}.`
            : `Loaded miles are not entered on load ${load.loadNumber}.`,
      });
    }

    const requiredMissing = missing.length > 0;
    const economicsReady = load.grossRate !== null && load.loadedMiles !== null;
    if (load.status === 'delivered' && !requiredMissing && economicsReady) {
      items.push({
        id: `closeout_incomplete:load:${load.id}`,
        sourceObjectType: 'load',
        sourceObjectId: load.id,
        kind: 'closeout_incomplete',
        urgency: 'soon',
        title: 'Confirm local closeout',
        context: routeLabel(load),
        deepLink: loadLink(load.id),
        reason: `Load ${load.loadNumber} is delivered. Local paperwork and economics are present; paid status is still a user confirmation. Not broker payment proof.`,
      });
    }
  }

  for (const receivable of input.receivables) {
    if (isTerminalReceivable(receivable.status)) continue;
    const outstanding = receivableOutstanding(receivable);
    if (outstanding <= 0 && receivable.status !== 'overdue' && receivable.status !== 'disputed') {
      continue;
    }
    const overdue = isReceivableOverdue(receivable, receivableAgeDays(receivable, nowMs));
    const load = input.loads.find((l) => l.id === receivable.loadId);
    items.push({
      id: `receivable_attention:receivable:${receivable.id}`,
      sourceObjectType: 'receivable',
      sourceObjectId: receivable.id,
      kind: 'receivable_attention',
      urgency: overdue || receivable.status === 'disputed' ? 'now' : 'soon',
      title: `${receivableTypeLabel(receivable.type)} needs attention`,
      context: load ? routeLabel(load) : 'Unassigned receivable',
      deepLink: load ? loadLink(load.id) : { pathname: '/(tabs)/loads' },
      reason: overdue
        ? `${receivableTypeLabel(receivable.type)} is overdue. Local money-owed state only.`
        : `${receivableTypeLabel(receivable.type)} is ${receivable.status} with an outstanding balance.`,
    });
  }

  const unclassified = unclassifiedMiles(input.segments);
  if (unclassified > 0) {
    const first = input.segments.find((s) => s.accountingCategory === 'unclassified');
    items.push({
      id: 'unclassified_mileage:mileage:ledger',
      sourceObjectType: 'mileage',
      sourceObjectId: first?.id ?? 'ledger',
      kind: 'unclassified_mileage',
      urgency: 'now',
      title: 'Classify mileage',
      context: `${unclassified} unclassified miles`,
      deepLink: { pathname: '/mileage-review' },
      reason: 'One or more Live Mileage segments are still unclassified. Driver-confirmed only.',
    });
  }

  if (input.roadWallet) {
    if (input.roadWallet.expired > 0) {
      items.push({
        id: 'road_wallet:road_wallet:expired',
        sourceObjectType: 'road_wallet',
        sourceObjectId: 'wallet',
        kind: 'road_wallet',
        urgency: 'now',
        title: 'Road Wallet documents expired',
        context: `${input.roadWallet.expired} expired`,
        deepLink: { pathname: '/road-wallet' },
        reason: 'Road Wallet reports expired operational documents. Not a load-paperwork status.',
      });
    } else if (input.roadWallet.expiringSoon > 0) {
      items.push({
        id: 'road_wallet:road_wallet:expiring',
        sourceObjectType: 'road_wallet',
        sourceObjectId: 'wallet',
        kind: 'road_wallet',
        urgency: 'soon',
        title: 'Road Wallet documents expiring soon',
        context: `${input.roadWallet.expiringSoon} expiring soon`,
        deepLink: { pathname: '/road-wallet' },
        reason: 'Road Wallet reports operational documents expiring soon.',
      });
    }
  }

  if (input.packets) {
    for (const packet of input.packets) {
      if (packet.status === 'SHARED' || packet.status === 'SUPERSEDED') continue;
      if (packet.status === 'DRAFT') {
        items.push({
          id: `carrier_packet:carrier_packet:${packet.id}:draft`,
          sourceObjectType: 'carrier_packet',
          sourceObjectId: packet.id,
          kind: 'carrier_packet',
          urgency: 'later',
          title: 'Finish carrier packet',
          context: packet.name,
          deepLink: { pathname: '/carrier-packet-detail', params: { id: packet.id } },
          reason:
            'Packet is DRAFT. Ready/Shared stay explicit user actions. SHARED is attestation only — not delivery.',
        });
        continue;
      }
      if (packet.status === 'READY') {
        items.push({
          id: `carrier_packet:carrier_packet:${packet.id}:ready`,
          sourceObjectType: 'carrier_packet',
          sourceObjectId: packet.id,
          kind: 'carrier_packet',
          urgency: 'soon',
          title: 'Review carrier packet',
          context: packet.name,
          deepLink: { pathname: '/carrier-packet-review', params: { id: packet.id } },
          reason:
            'Packet is READY for the user to review. Mark Shared is an attestation, not delivery or broker acceptance.',
        });
        continue;
      }
      const exhaustive: never = packet.status;
      void exhaustive;
    }
  }

  return sortActionItems(items);
}

export function actionItemsForLoad(items: readonly ActionItem[], loadId: string): ActionItem[] {
  return items.filter(
    (item) =>
      (item.sourceObjectType === 'load' && item.sourceObjectId === loadId) ||
      (item.sourceObjectType === 'receivable' && item.deepLink.params?.id === loadId),
  );
}
