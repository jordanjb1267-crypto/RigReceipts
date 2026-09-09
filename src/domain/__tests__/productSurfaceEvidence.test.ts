import { deriveActionItems } from '../actionItems';
import { buildLoadEconomicsPacket } from '../loadEconomicsPacket';
import { groupLoadsForList } from '../loadGroups';

/**
 * Deterministic UI-contract evidence for the principal product surfaces.
 * These objects are what Dashboard / Load Packet / Loads list render.
 */
describe('principal product surface view models', () => {
  const load = {
    id: 'load_demo',
    loadNumber: '48291',
    origin: 'Chicago, IL',
    destination: 'Dallas, TX',
    broker: null,
    status: 'delivered' as const,
    grossRate: 2400,
    fuelSurcharge: null,
    loadedMiles: 800,
    deadheadMiles: 80,
    bolRequired: true,
  };

  it('Load Economics Packet hero only reports entered fields', () => {
    const packet = buildLoadEconomicsPacket({
      load,
      docs: [],
      captures: [],
      slots: [],
      captureRecords: [],
      receivables: [],
      segments: [],
      targets: null,
      nowMs: Date.parse('2026-09-09T00:00:00.000Z'),
    });

    expect({
      route: `${packet.origin} → ${packet.destination}`,
      status: packet.status,
      grossRate: packet.grossRate,
      allMileRpm: packet.allMileRpm,
      targetComparison: packet.rateStatus,
      estimatedContribution: packet.estimatedContribution,
      plannedLoaded: packet.plannedMiles.loadedMiles,
      plannedDeadhead: packet.plannedMiles.deadheadMiles,
      plannedTotal: packet.plannedMiles.totalMiles,
      actualLiveMileage: packet.actualLiveMileage,
      paidMiles: packet.paidMiles,
      routeEstimate: packet.routeEstimate,
      documentsRemaining: packet.documentsRemaining,
      primaryAction: packet.primaryAction?.title,
      localComplete: packet.localComplete,
      externallyDelivered: packet.externallyDelivered,
      recipientAccepted: packet.recipientAccepted,
    }).toEqual({
      route: 'Chicago, IL → Dallas, TX',
      status: 'delivered',
      grossRate: 2400,
      allMileRpm: 2.73,
      targetComparison: 'unknown',
      estimatedContribution: null,
      plannedLoaded: 800,
      plannedDeadhead: 80,
      plannedTotal: 880,
      actualLiveMileage: null,
      paidMiles: null,
      routeEstimate: null,
      documentsRemaining: ['rate_confirmation', 'pod', 'bol'],
      primaryAction: 'Scan BOL',
      localComplete: false,
      externallyDelivered: false,
      recipientAccepted: false,
    });
  });

  it('Today / Needs Action and load grouping stay derived', () => {
    const items = deriveActionItems({
      loads: [load],
      docs: [],
      captures: [],
      receivables: [],
      segments: [],
      nowMs: Date.parse('2026-09-09T00:00:00.000Z'),
    });
    const grouped = groupLoadsForList([load], items);
    expect(grouped.saved).toHaveLength(0);
    expect(grouped.needsAction).toHaveLength(1);
    expect(grouped.active).toHaveLength(0);
    expect(grouped.closed).toHaveLength(0);
    expect(items.every((i) => i.reason.length > 0)).toBe(true);
    expect(items.some((i) => i.deepLink.pathname === '/(tabs)/scan')).toBe(true);
  });
});
