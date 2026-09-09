import { deriveActionItems } from '../actionItems';
import { MileageSegment } from '../mileageSession';

const load = {
  id: 'load_1',
  loadNumber: '48291',
  origin: 'Chicago, IL',
  destination: 'Dallas, TX',
  status: 'delivered' as const,
  grossRate: 2400,
  loadedMiles: 900,
  bolRequired: true,
};

const segment = (over: Partial<MileageSegment> = {}): MileageSegment => ({
  id: 'seg_1',
  sessionId: 's1',
  loadId: 'load_1',
  startedAt: 1,
  endedAt: 2,
  startLocation: null,
  endLocation: null,
  calculatedMiles: 12,
  adjustedMiles: null,
  accountingCategory: 'unclassified',
  businessSubtype: null,
  trailerConfiguration: 'unknown',
  classificationSource: 'user',
  classificationConfidence: null,
  userConfirmed: false,
  note: null,
  createdAt: 1,
  updatedAt: 1,
  ...over,
});

describe('deriveActionItems', () => {
  it('emits deterministic missing-document actions from delivered loads', () => {
    const items = deriveActionItems({
      loads: [load],
      docs: [],
      captures: [],
      receivables: [],
      segments: [],
    });
    const missing = items.filter((i) => i.kind === 'missing_document');
    expect(missing.map((i) => i.id)).toEqual([
      'missing_document:load:load_1:bol',
      'missing_document:load:load_1:pod',
      'missing_document:load:load_1:rate_confirmation',
    ]);
    expect(missing.every((i) => i.urgency === 'now')).toBe(true);
    expect(missing[0]?.deepLink.params).toMatchObject({
      loadId: 'load_1',
      intendedDocType: 'bol',
      sourceAction: 'missing_document',
    });
    expect(missing.every((i) => i.reason.includes('Local paperwork'))).toBe(true);
  });

  it('does not nag evaluated offers for POD', () => {
    const items = deriveActionItems({
      loads: [{ ...load, status: 'evaluated', grossRate: 1800 }],
      docs: [],
      captures: [],
      receivables: [],
      segments: [],
    });
    expect(items.some((i) => i.kind === 'missing_document')).toBe(false);
  });

  it('emits closeout only when delivered paperwork and economics are present', () => {
    const items = deriveActionItems({
      loads: [load],
      docs: [
        { loadId: 'load_1', docType: 'rate_confirmation', status: 'captured' },
        { loadId: 'load_1', docType: 'pod', status: 'reviewed' },
        { loadId: 'load_1', docType: 'bol', status: 'complete' },
      ],
      captures: [],
      receivables: [],
      segments: [],
    });
    expect(items.map((i) => i.kind)).toEqual(['closeout_incomplete']);
    expect(items[0]?.reason).toContain('Not broker payment proof');
  });

  it('flags unclassified mileage and overdue receivables without AI urgency', () => {
    const items = deriveActionItems({
      loads: [{ ...load, status: 'in_transit' }],
      docs: [
        { loadId: 'load_1', docType: 'rate_confirmation', status: 'captured' },
        { loadId: 'load_1', docType: 'pod', status: 'captured' },
        { loadId: 'load_1', docType: 'bol', status: 'captured' },
      ],
      captures: [],
      receivables: [
        {
          id: 'rcv_1',
          loadId: 'load_1',
          type: 'detention',
          status: 'overdue',
          amountExpected: 150,
          amountReceived: 0,
          dateDue: '2020-01-01',
        },
      ],
      segments: [segment()],
      nowMs: Date.parse('2026-09-09'),
    });
    expect(items.some((i) => i.kind === 'unclassified_mileage' && i.urgency === 'now')).toBe(true);
    expect(items.some((i) => i.kind === 'receivable_attention' && i.urgency === 'now')).toBe(true);
  });

  it('includes Road Wallet and Carrier Packet actions only when snapshots are provided', () => {
    const none = deriveActionItems({
      loads: [],
      docs: [],
      captures: [],
      receivables: [],
      segments: [],
    });
    expect(none).toEqual([]);

    const withExtras = deriveActionItems({
      loads: [],
      docs: [],
      captures: [],
      receivables: [],
      segments: [],
      roadWallet: { expired: 1, expiringSoon: 0 },
      packets: [
        { id: 'pkt_ready', name: 'Standard broker', status: 'READY' },
        { id: 'pkt_shared', name: 'Already attested', status: 'SHARED' },
      ],
    });
    expect(withExtras.map((i) => i.kind).sort()).toEqual(['carrier_packet', 'road_wallet']);
    expect(withExtras.find((i) => i.kind === 'carrier_packet')?.reason).toContain(
      'attestation, not delivery',
    );
    expect(withExtras.some((i) => i.sourceObjectId === 'pkt_shared')).toBe(false);
  });
});
