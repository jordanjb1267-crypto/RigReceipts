import { CloudSyncContext, newOpaqueId, OperationalDocument } from '@/domain';
import { usePresentationSetsStore } from '@/store/presentationSets';
import { useRoadWalletStore } from '@/store/roadWallet';
import { useSubscriptionStore } from '@/store/subscription';
import { useAuthStore } from '@/store/auth';

import { MemoryDocumentFileStore } from '../documentFiles';
import {
  archiveCustomPresentationSet,
  buildQuickPresentSession,
  createCustomPresentationSet,
  destroyPresentationSession,
  PresentationSetDeniedError,
  runPresentationPreflight,
  setPresentationSetItems,
  updateCustomPresentationSet,
} from '../presentationSets';
import { configureRoadWalletFileStore, createOperationalDocumentFromFile } from '../roadWallet';

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 1, 2, 3, 4]);
const PDF = new TextEncoder().encode('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n');

let fileStore: MemoryDocumentFileStore;
let seed = 0;
const nextId = () => {
  seed++;
  const s = seed;
  return newOpaqueId(
    () => new Uint8Array(Array.from({ length: 16 }, (_, i) => (i * 23 + s * 11) & 0xff)),
  );
};

const signIn = (userId: string | null) =>
  useAuthStore.setState({ userId, status: userId ? 'signed_in' : 'signed_out', session: null });
const setTier = (tier: 'free' | 'driver_pro') => useSubscriptionStore.getState().setTier(tier);

const deps = () => ({
  fileStore,
  ctx: (): CloudSyncContext => ({
    userId: useAuthStore.getState().userId,
    tier: useSubscriptionStore.getState().tier,
    supabaseConfigured: true,
  }),
  now: () => 9_000,
  newId: nextId,
});

const addDoc = async (
  kind: OperationalDocument['documentKind'] = 'CDL',
  uri = 'file:///tmp/picker/cdl.jpg',
  mime = 'image/jpeg',
) =>
  createOperationalDocumentFromFile(
    { uri, mimeType: mime, name: 'x.jpg' },
    { documentKind: kind, title: kind },
    deps(),
  );

beforeEach(() => {
  usePresentationSetsStore.getState().clear();
  useRoadWalletStore.getState().clear();
  destroyPresentationSession();
  fileStore = new MemoryDocumentFileStore();
  fileStore.addSource('file:///tmp/picker/cdl.jpg', JPEG, 'image/jpeg');
  fileStore.addSource('file:///tmp/picker/w9.jpg', JPEG, 'image/jpeg');
  fileStore.addSource('file:///tmp/picker/coi.pdf', PDF, 'application/pdf');
  configureRoadWalletFileStore(fileStore);
  signIn('user-a');
  setTier('driver_pro');
  seed = 0;
});

afterAll(() => configureRoadWalletFileStore(null));

describe('custom set entitlement boundary', () => {
  it('Driver Pro can create, update, set items and archive; Free cannot mutate', async () => {
    const { document } = await addDoc();
    const created = createCustomPresentationSet({ name: 'Pack', documentIds: [document.id] }, deps());
    expect(created.setKind).toBe('CUSTOM');
    expect(usePresentationSetsStore.getState().items).toHaveLength(1);
    updateCustomPresentationSet(created.id, { name: 'Renamed' }, deps());
    expect(usePresentationSetsStore.getState().sets[0]?.name).toBe('Renamed');
    archiveCustomPresentationSet(created.id, deps());
    expect(usePresentationSetsStore.getState().sets[0]?.lifecycle).toBe('ARCHIVED');

    setTier('free');
    expect(() => createCustomPresentationSet({ name: 'Nope' }, deps())).toThrow(PresentationSetDeniedError);
    expect(() => updateCustomPresentationSet(created.id, { name: 'X' }, deps())).toThrow(
      PresentationSetDeniedError,
    );
    expect(usePresentationSetsStore.getState().sets[0]?.name).toBe('Renamed');
  });

  it('refuses FINANCIAL documents at the item-write boundary', async () => {
    const { document } = await addDoc('W9', 'file:///tmp/picker/w9.jpg');
    const created = createCustomPresentationSet({ name: 'Pack' }, deps());
    expect(() => setPresentationSetItems(created.id, [document.id], deps())).toThrow(
      /FINANCIAL_BLOCKED/,
    );
    expect(usePresentationSetsStore.getState().items).toHaveLength(0);
  });
});

describe('preflight + session builder', () => {
  it('READY image → session; PDF is external-only; 0 images → no session', async () => {
    const { document } = await addDoc();
    const pre = await runPresentationPreflight([document.id], deps());
    expect(pre.overall).toBe('READY');
    expect(pre.needsPersonalAck).toBe(true);

    await expect(
      buildQuickPresentSession(
        {
          setId: 'system:roadside',
          setKind: 'SYSTEM_ROADSIDE',
          setName: 'Roadside',
          documentIds: [document.id],
          personalAcknowledged: false,
        },
        deps(),
      ),
    ).rejects.toThrow(/PERSONAL_ACK_REQUIRED/);

    const session = await buildQuickPresentSession(
      {
        setId: 'system:roadside',
        setKind: 'SYSTEM_ROADSIDE',
        setName: 'Roadside',
        documentIds: [document.id],
        personalAcknowledged: true,
      },
      deps(),
    );
    expect(session.items).toHaveLength(1);
    expect(session.items[0]?.exactVersionId).toBeTruthy();
    expect(JSON.stringify(session)).not.toMatch(/sha256|road-wallet\/|broker|expense/i);

    const pdf = await addDoc('CERTIFICATE_OF_INSURANCE', 'file:///tmp/picker/coi.pdf', 'application/pdf');
    const pdfPre = await runPresentationPreflight([pdf.document.id], deps());
    expect(pdfPre.items[0]?.state).toBe('PDF_EXTERNAL_ONLY');
    expect(pdfPre.overall).toBe('EMPTY');
    await expect(
      buildQuickPresentSession(
        {
          setId: 'system:shipper',
          setKind: 'SYSTEM_SHIPPER',
          setName: 'Shipper',
          documentIds: [pdf.document.id],
          personalAcknowledged: true,
        },
        deps(),
      ),
    ).rejects.toThrow(/NO_READY_IMAGES/);
  });

  it('custom session requires savedPresentationSets; Free uses built-in only', async () => {
    const { document } = await addDoc();
    const created = createCustomPresentationSet({ name: 'Pack', documentIds: [document.id] }, deps());
    setTier('free');
    await expect(
      buildQuickPresentSession(
        {
          setId: created.id,
          setKind: 'CUSTOM',
          setName: 'Pack',
          documentIds: [document.id],
          personalAcknowledged: true,
        },
        deps(),
      ),
    ).rejects.toThrow(PresentationSetDeniedError);

    const builtIn = await buildQuickPresentSession(
      {
        setId: 'system:roadside',
        setKind: 'SYSTEM_ROADSIDE',
        setName: 'Roadside',
        documentIds: [document.id],
        personalAcknowledged: true,
      },
      deps(),
    );
    expect(builtIn.items).toHaveLength(1);
  });
});
