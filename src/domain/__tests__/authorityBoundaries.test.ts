import { CARRIER_PACKET_DISCLAIMER, MARK_SHARED_ATTESTATION_COPY } from '../carrierPackets';
import { LOAD_DOCUMENT_IDENTITY_NOTE } from '../loadDocuments';
import { ACTION_ITEM_KINDS } from '../actionItems';

describe('authority boundaries for the product-local pass', () => {
  it('does not add FreightOS or InterBraid kinds to action items', () => {
    expect(ACTION_ITEM_KINDS).not.toEqual(expect.arrayContaining(['responsibility', 'freightos']));
    expect(ACTION_ITEM_KINDS.join(',')).not.toMatch(/freightos|interbraid|responsibility/i);
  });

  it('keeps Carrier Packet SHARED as attestation, not delivery', () => {
    expect(CARRIER_PACKET_DISCLAIMER.toLowerCase()).toContain('broker will accept');
    expect(MARK_SHARED_ATTESTATION_COPY.toLowerCase()).toContain('does not prove delivery');
    expect(MARK_SHARED_ATTESTATION_COPY.toLowerCase()).not.toContain('broker accepted');
    expect(LOAD_DOCUMENT_IDENTITY_NOTE).toContain('CarrierPacketItem identity are unchanged');
  });

  it('never equates local complete with shared/delivered/accepted in copy', () => {
    expect(LOAD_DOCUMENT_IDENTITY_NOTE.toLowerCase()).not.toContain('recipient accepted');
  });
});
