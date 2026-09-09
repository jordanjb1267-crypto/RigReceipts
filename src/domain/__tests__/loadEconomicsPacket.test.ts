import { buildLoadEconomicsPacket } from '../loadEconomicsPacket';

const load = {
  id: 'load_1',
  loadNumber: '99',
  origin: 'A',
  destination: 'B',
  broker: 'Acme',
  status: 'in_transit' as const,
  grossRate: 2000,
  fuelSurcharge: 100,
  loadedMiles: 500,
  deadheadMiles: 50,
  bolRequired: true,
};

describe('buildLoadEconomicsPacket', () => {
  it('shows entered economics and keeps actual / paid / route miles distinct', () => {
    const packet = buildLoadEconomicsPacket({
      load,
      docs: [{ loadId: 'load_1', docType: 'rate_confirmation', status: 'captured' }],
      captures: [],
      slots: [
        {
          id: 's1',
          loadId: 'load_1',
          docType: 'rate_confirmation',
          status: 'captured',
          scanId: null,
        },
      ],
      captureRecords: [],
      receivables: [
        {
          id: 'r1',
          loadId: 'load_1',
          type: 'lumper',
          status: 'submitted',
          amountExpected: 80,
          amountReceived: 0,
          dateDue: null,
        },
      ],
      segments: [],
      targets: null,
    });

    expect(packet.grossRate).toBe(2000);
    expect(packet.revenue).toBe(2100);
    expect(packet.allMileRpm).toBeCloseTo(2100 / 550, 5);
    expect(packet.rateStatus).toBe('unknown');
    expect(packet.plannedMiles.totalMiles).toBe(550);
    expect(packet.actualLiveMileage).toBeNull();
    expect(packet.paidMiles).toBeNull();
    expect(packet.routeEstimate).toBeNull();
    expect(packet.documentsRemaining).toEqual(['pod', 'bol']);
    expect(packet.outstandingReceivableUsd).toBe(80);
    expect(packet.externallyDelivered).toBe(false);
    expect(packet.recipientAccepted).toBe(false);
    expect(packet.localComplete).toBe(false);
    expect(packet.integrationSeams.externalTmsLoad).toBeNull();
    expect(packet.integrationSeams.documentDelivery).toBeNull();
  });

  it('does not fabricate RPM or contribution when miles are missing', () => {
    const packet = buildLoadEconomicsPacket({
      load: { ...load, loadedMiles: null, deadheadMiles: null, grossRate: 2000 },
      docs: [],
      captures: [],
      slots: [],
      captureRecords: [],
      receivables: [],
      segments: [],
      targets: null,
    });
    expect(packet.allMileRpm).toBeNull();
    expect(packet.estimatedContribution).toBeNull();
    expect(packet.plannedMiles.totalMiles).toBeNull();
  });

  it('separates Live Mileage actuals from planned miles', () => {
    const packet = buildLoadEconomicsPacket({
      load,
      docs: [],
      captures: [],
      slots: [],
      captureRecords: [],
      receivables: [],
      segments: [
        {
          id: 'seg',
          sessionId: 's',
          loadId: 'load_1',
          startedAt: 1,
          endedAt: 2,
          startLocation: null,
          endLocation: null,
          calculatedMiles: 40,
          adjustedMiles: null,
          accountingCategory: 'loaded',
          businessSubtype: null,
          trailerConfiguration: 'unknown',
          classificationSource: 'user',
          classificationConfidence: null,
          userConfirmed: true,
          note: null,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      targets: null,
    });
    expect(packet.plannedMiles.loadedMiles).toBe(500);
    expect(packet.actualLiveMileage?.loadedMiles).toBe(40);
    expect(packet.actualLiveMileage?.totalMiles).toBe(40);
  });
});
