import { attachConfirmedCaptureToLoad } from '../loadScanAttach';
import { useCapturesStore } from '@/store/captures';
import { useLoadDocsStore } from '@/store/loadDocs';

describe('attachConfirmedCaptureToLoad', () => {
  beforeEach(() => {
    useCapturesStore.getState().clear();
    useLoadDocsStore.getState().clear();
  });

  it('files through existing stores and does not invent delivery state', () => {
    const id = useCapturesStore.getState().addCapture(
      {
        scanType: 'other',
        imageUri: null,
        engine: 'stub',
        rawText: 'RATE CON',
        vendor: null,
        totalUsd: null,
        date: null,
        gallons: null,
        intendedDocType: 'rate_confirmation',
      },
      { status: 'local_only', accountOwnerId: null },
    );

    attachConfirmedCaptureToLoad(id, 'load_1', 'rate_confirmation');

    const capture = useCapturesStore.getState().captures.find((c) => c.id === id);
    const slot = useLoadDocsStore
      .getState()
      .docs.find((d) => d.loadId === 'load_1' && d.docType === 'rate_confirmation');
    expect(capture?.loadId).toBe('load_1');
    expect(slot?.status).toBe('captured');
    expect(slot?.scanId).toBe(id);
    expect(JSON.stringify(capture)).not.toMatch(/delivered|accepted|freightos/i);
  });

  it('keeps a single slot per loadId+docType when rescanned', () => {
    const first = useCapturesStore.getState().addCapture(
      {
        scanType: 'pod',
        imageUri: null,
        engine: 'stub',
        rawText: 'POD 1',
        vendor: null,
        totalUsd: null,
        date: null,
        gallons: null,
        intendedDocType: 'pod',
      },
      { status: 'local_only', accountOwnerId: null },
    );
    const second = useCapturesStore.getState().addCapture(
      {
        scanType: 'pod',
        imageUri: null,
        engine: 'stub',
        rawText: 'POD 2',
        vendor: null,
        totalUsd: null,
        date: null,
        gallons: null,
        intendedDocType: 'pod',
      },
      { status: 'local_only', accountOwnerId: null },
    );

    attachConfirmedCaptureToLoad(first, 'load_1', 'pod');
    attachConfirmedCaptureToLoad(second, 'load_1', 'pod');

    const slots = useLoadDocsStore
      .getState()
      .docs.filter((d) => d.loadId === 'load_1' && d.docType === 'pod');
    expect(slots).toHaveLength(1);
    expect(slots[0]?.scanId).toBe(second);
    expect(useCapturesStore.getState().captures.filter((c) => c.loadId === 'load_1')).toHaveLength(
      2,
    );
  });
});
