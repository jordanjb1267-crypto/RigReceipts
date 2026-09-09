import { DOCUMENT_STATUSES } from '../documents';
import {
  assertInertExchangeProjection,
  DEFAULT_LOAD_DOCUMENT_EXCHANGE,
  expenseCategoryForCapture,
  LOAD_DOCUMENT_EXCHANGE_STATES,
  LOAD_DOCUMENT_IDENTITY_NOTE,
  missingRequiredDocTypes,
  reconcileLoadDocuments,
  resolvedLoadDocType,
  scanTypeForDocumentType,
  storageClassForCapture,
} from '../loadDocuments';

describe('load document reconciliation', () => {
  it('keeps requirement, artifact, and Road Wallet version as separate ideas', () => {
    const result = reconcileLoadDocuments({
      loadId: 'L1',
      bolRequired: true,
      slots: [
        {
          id: 'slot-pod',
          loadId: 'L1',
          docType: 'pod',
          status: 'captured',
          scanId: 'cap-pod-2',
        },
      ],
      captures: [
        { id: 'cap-pod-1', loadId: 'L1', scanType: 'pod' },
        { id: 'cap-pod-2', loadId: 'L1', scanType: 'pod' },
        { id: 'cap-rc', loadId: 'L1', scanType: 'other', intendedDocType: 'rate_confirmation' },
      ],
    });

    expect(result.slotUniqueness).toBe('loadId_plus_docType');
    expect(result.multipleSameTypeVia).toBe('capture_artifacts');
    expect(result.stopScopedDocuments).toBe(false);
    expect(result.immutableVersionHistory).toBe('road_wallet_document_version_only');
    expect(result.artifacts.filter((a) => a.docType === 'pod')).toHaveLength(2);
    expect(result.requirements.find((r) => r.docType === 'pod')?.artifactCount).toBe(2);
    expect(result.requirements.find((r) => r.docType === 'rate_confirmation')?.state).toBe(
      'satisfied',
    );
    expect(result.requirements.find((r) => r.docType === 'bol')?.state).toBe('open');
    expect(LOAD_DOCUMENT_IDENTITY_NOTE).toContain('DocumentVersion');
  });

  it('does not treat local complete as delivery or acceptance', () => {
    expect(DOCUMENT_STATUSES).toEqual(['missing', 'captured', 'reviewed', 'complete']);
    expect(LOAD_DOCUMENT_EXCHANGE_STATES).toEqual(['not_projected', 'local_only', 'unknown']);
    expect(DEFAULT_LOAD_DOCUMENT_EXCHANGE.state).toBe('local_only');
    expect(() =>
      assertInertExchangeProjection({
        providerKind: 'unspecified',
        state: 'delivered' as never,
      }),
    ).toThrow(/inert/);
  });

  it('maps rate confirmation to canon scan type other', () => {
    expect(scanTypeForDocumentType('rate_confirmation')).toBe('other');
    expect(scanTypeForDocumentType('pod')).toBe('pod');
    expect(resolvedLoadDocType({ scanType: 'other', intendedDocType: 'rate_confirmation' })).toBe(
      'rate_confirmation',
    );
    expect(resolvedLoadDocType({ scanType: 'meal' })).toBeNull();
  });

  it('does not book an expense for an intended rate confirmation on other', () => {
    expect(
      expenseCategoryForCapture({ scanType: 'other', intendedDocType: 'rate_confirmation' }),
    ).toBeNull();
    expect(
      storageClassForCapture({ scanType: 'other', intendedDocType: 'rate_confirmation' }),
    ).toBe('LOAD_DOCUMENT');
    expect(expenseCategoryForCapture({ scanType: 'other' })).toBe('misc');
  });

  it('lists missing required docs without inventing extras', () => {
    expect(
      missingRequiredDocTypes(
        'L1',
        true,
        [{ loadId: 'L1', docType: 'rate_confirmation', status: 'captured' }],
        [],
      ),
    ).toEqual(['pod', 'bol']);
  });
});
