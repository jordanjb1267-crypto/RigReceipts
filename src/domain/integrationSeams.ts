/**
 * Bounded, provider-neutral seams for future external references.
 *
 * Rules:
 *   - optional / nullable
 *   - no production provider calls
 *   - no FreightOS imports
 *   - no InterBraid authority
 *   - no claim of delivery or recipient acceptance
 *
 * These types exist so product-local UI can name an absent reference without
 * inventing runtime truth.
 */

export const INTEGRATION_SEAM_KINDS = [
  'external_tms_load',
  'eld_evidence',
  'external_document_delivery',
  'service_expense_evidence',
  'payment_transaction_evidence',
] as const;
export type IntegrationSeamKind = (typeof INTEGRATION_SEAM_KINDS)[number];

/** Provider identity is an opaque label, never a live client. */
export interface ProviderNeutralRef {
  providerKind: string;
  externalId: string;
}

export interface ExternalTmsLoadRef extends ProviderNeutralRef {
  kind: 'external_tms_load';
}

export interface EldEvidenceRef extends ProviderNeutralRef {
  kind: 'eld_evidence';
}

/**
 * Delivery projection is inert. Allowed states cannot become "delivered" or
 * "accepted" — those require an authoritative external interface that this
 * product does not own.
 */
export const EXTERNAL_DELIVERY_PROJECTION_STATES = ['unknown', 'not_projected'] as const;
export type ExternalDeliveryProjectionState = (typeof EXTERNAL_DELIVERY_PROJECTION_STATES)[number];

export interface ExternalDocumentDeliveryProjection {
  kind: 'external_document_delivery';
  providerKind: string;
  state: ExternalDeliveryProjectionState;
}

export interface ServiceExpenseEvidenceRef extends ProviderNeutralRef {
  kind: 'service_expense_evidence';
}

export interface PaymentTransactionEvidenceRef extends ProviderNeutralRef {
  kind: 'payment_transaction_evidence';
}

export interface LoadIntegrationSeams {
  externalTmsLoad: ExternalTmsLoadRef | null;
  eldEvidence: EldEvidenceRef | null;
  documentDelivery: ExternalDocumentDeliveryProjection | null;
  serviceExpenseEvidence: ServiceExpenseEvidenceRef | null;
  paymentTransactionEvidence: PaymentTransactionEvidenceRef | null;
}

export const EMPTY_LOAD_INTEGRATION_SEAMS: LoadIntegrationSeams = {
  externalTmsLoad: null,
  eldEvidence: null,
  documentDelivery: null,
  serviceExpenseEvidence: null,
  paymentTransactionEvidence: null,
};

export function emptyLoadIntegrationSeams(): LoadIntegrationSeams {
  return { ...EMPTY_LOAD_INTEGRATION_SEAMS };
}

export function isExternalDeliveryProjectionState(
  value: string,
): value is ExternalDeliveryProjectionState {
  return (EXTERNAL_DELIVERY_PROJECTION_STATES as readonly string[]).includes(value);
}

/** Rejects any attempt to store delivery/acceptance as a seam value. */
export function assertInertDeliveryProjection(
  projection: ExternalDocumentDeliveryProjection,
): ExternalDocumentDeliveryProjection {
  if (!isExternalDeliveryProjectionState(projection.state)) {
    throw new Error('document delivery projection cannot claim delivery or acceptance');
  }
  return projection;
}
