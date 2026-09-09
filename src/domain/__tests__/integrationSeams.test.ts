import {
  assertInertDeliveryProjection,
  emptyLoadIntegrationSeams,
  EXTERNAL_DELIVERY_PROJECTION_STATES,
} from '../integrationSeams';

describe('integration seams', () => {
  it('starts empty, nullable, and provider-neutral', () => {
    const seams = emptyLoadIntegrationSeams();
    expect(seams.externalTmsLoad).toBeNull();
    expect(seams.eldEvidence).toBeNull();
    expect(seams.documentDelivery).toBeNull();
    expect(seams.serviceExpenseEvidence).toBeNull();
    expect(seams.paymentTransactionEvidence).toBeNull();
    expect(EXTERNAL_DELIVERY_PROJECTION_STATES).toEqual(['unknown', 'not_projected']);
  });

  it('refuses delivery or acceptance as projection state', () => {
    expect(() =>
      assertInertDeliveryProjection({
        kind: 'external_document_delivery',
        providerKind: 'unspecified',
        state: 'accepted' as never,
      }),
    ).toThrow(/cannot claim delivery or acceptance/);
  });
});
