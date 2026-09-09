import { AppState } from 'react-native';

import { CloudSyncContext, newOpaqueId, OperationalDocument } from '@/domain';
import { usePresentationSetsStore } from '@/store/presentationSets';
import { useRoadWalletStore } from '@/store/roadWallet';
import { useSubscriptionStore } from '@/store/subscription';
import { useAuthStore } from '@/store/auth';

import { MemoryDocumentFileStore } from '../documentFiles';
import {
  activePresentationSession,
  archiveCustomPresentationSet,
  buildQuickPresentSession,
  createCustomPresentationSet,
  defaultPresentationSetDeps,
  destroyPresentationSession,
  PresentationSetDeniedError,
  runPresentationPreflight,
  setPresentationSetItems,
  updateCustomPresentationSet,
} from '../presentationSets';
import {
  configureRoadWalletFileStore,
  createOperationalDocumentFromFile,
  replaceOperationalDocumentFile,
  shareOperationalDocumentVersion,
} from '../roadWallet';

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
    expect(session.items[0]).not.toHaveProperty('sha256');
    expect(session.items[0]).not.toHaveProperty('remoteStoragePath');
    expect(session.items[0]).not.toHaveProperty('byteSize');
    expect(JSON.stringify(session)).not.toMatch(/broker|expense/i);

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

describe('Pass 2.1 H1 — local membership tombstones', () => {
  it('remove keeps included=false, re-add reuses the id, reorder is stable, identical edit is idempotent', async () => {
    const a = await addDoc();
    const b = await addDoc();
    const created = createCustomPresentationSet(
      { name: 'Pack', documentIds: [a.document.id, b.document.id] },
      deps(),
    );
    const first = usePresentationSetsStore
      .getState()
      .items.filter((i) => i.presentationSetId === created.id);
    expect(first).toHaveLength(2);
    const idA = first.find((i) => i.operationalDocumentId === a.document.id)!.id;
    const idB = first.find((i) => i.operationalDocumentId === b.document.id)!.id;

    const afterRemove = setPresentationSetItems(created.id, [a.document.id], deps());
    expect(afterRemove.find((i) => i.operationalDocumentId === b.document.id)).toMatchObject({
      id: idB,
      included: false,
    });
    expect(afterRemove.find((i) => i.operationalDocumentId === a.document.id)).toMatchObject({
      id: idA,
      included: true,
    });

    const afterReadd = setPresentationSetItems(
      created.id,
      [a.document.id, b.document.id],
      deps(),
    );
    expect(afterReadd.find((i) => i.operationalDocumentId === b.document.id)).toMatchObject({
      id: idB,
      included: true,
      position: 1,
    });

    const reordered = setPresentationSetItems(
      created.id,
      [b.document.id, a.document.id],
      deps(),
    );
    expect(reordered.map((i) => i.id).sort()).toEqual([idA, idB].sort());
    expect(reordered.find((i) => i.operationalDocumentId === b.document.id)?.position).toBe(0);

    const again = setPresentationSetItems(created.id, [b.document.id, a.document.id], deps());
    expect(again.map((i) => i.id)).toEqual(reordered.map((i) => i.id));
    expect(again.map((i) => i.included)).toEqual(reordered.map((i) => i.included));
  });
});

describe('Pass 2.1 H4/H5/H6/H9 — preflight and live session races', () => {
  const roadside = (documentId: string, ack = true) => ({
    setId: 'system:roadside',
    setKind: 'SYSTEM_ROADSIDE' as const,
    setName: 'Roadside',
    documentIds: [documentId],
    personalAcknowledged: ack,
  });

  const wrapVerify = (fn: () => void | Promise<void>) => {
    const orig = fileStore.verify.bind(fileStore);
    let once = false;
    fileStore.verify = async (path, opts) => {
      if (!once) {
        once = true;
        await fn();
      }
      return orig(path, opts);
    };
    return orig;
  };

  it('account switch during preflight cancels and does not apply the prior file cache', async () => {
    const { document, version } = await addDoc();
    const before = useRoadWalletStore.getState().versions.find((v) => v.id === version.id)!.fileCache;
    wrapVerify(() => {
      signIn('user-b');
    });
    await expect(runPresentationPreflight([document.id], deps())).rejects.toMatchObject({
      reason: 'PREFLIGHT_SESSION_CHANGED',
    });
    const after = useRoadWalletStore.getState().versions.find((v) => v.id === version.id)!.fileCache;
    expect(after).toEqual(before);
  });

  it('device-only → signed-in during preflight cancels', async () => {
    signIn(null);
    const { document } = await addDoc();
    wrapVerify(() => {
      signIn('user-a');
    });
    await expect(runPresentationPreflight([document.id], deps())).rejects.toMatchObject({
      reason: 'PREFLIGHT_SESSION_CHANGED',
    });
  });

  it('account switch during build blocks the session', async () => {
    const { document } = await addDoc();
    wrapVerify(() => {
      signIn('user-b');
    });
    await expect(buildQuickPresentSession(roadside(document.id), deps())).rejects.toMatchObject({
      reason: 'PREFLIGHT_SESSION_CHANGED',
    });
    expect(activePresentationSession()).toBeNull();
  });

  it('tier loss during custom build blocks', async () => {
    const { document } = await addDoc();
    const created = createCustomPresentationSet(
      { name: 'Pack', documentIds: [document.id] },
      deps(),
    );
    wrapVerify(() => {
      setTier('free');
    });
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
    ).rejects.toMatchObject({ reason: 'NOT_ENTITLED' });
    expect(activePresentationSession()).toBeNull();
  });

  it('custom set archived during build blocks', async () => {
    const { document } = await addDoc();
    const created = createCustomPresentationSet(
      { name: 'Pack', documentIds: [document.id] },
      deps(),
    );
    wrapVerify(() => {
      archiveCustomPresentationSet(created.id, deps());
    });
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
    ).rejects.toMatchObject({ reason: 'SET_ARCHIVED' });
    expect(activePresentationSession()).toBeNull();
  });

  it('archived custom set is denied at the data-layer boundary', async () => {
    const { document } = await addDoc();
    const created = createCustomPresentationSet(
      { name: 'Pack', documentIds: [document.id] },
      deps(),
    );
    archiveCustomPresentationSet(created.id, deps());
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
    ).rejects.toMatchObject({ reason: 'SET_ARCHIVED' });
  });

  it('document archived during build blocks', async () => {
    const { document } = await addDoc();
    wrapVerify(() => {
      useRoadWalletStore.getState().archiveDocument(document.id, deps().ctx());
    });
    await expect(buildQuickPresentSession(roadside(document.id), deps())).rejects.toMatchObject({
      reason: 'ARCHIVED',
    });
    expect(activePresentationSession()).toBeNull();
  });

  it('document becoming FINANCIAL during build blocks', async () => {
    const { document } = await createOperationalDocumentFromFile(
      { uri: 'file:///tmp/picker/cdl.jpg', mimeType: 'image/jpeg', name: 'x.jpg' },
      { documentKind: 'CUSTOM', title: 'Agreement', sensitivity: 'STANDARD' },
      deps(),
    );
    wrapVerify(() => {
      useRoadWalletStore
        .getState()
        .updateDocumentMetadata(document.id, { sensitivity: 'FINANCIAL_SENSITIVE' }, deps().ctx());
    });
    await expect(buildQuickPresentSession(roadside(document.id, false), deps())).rejects.toMatchObject({
      reason: 'FINANCIAL_BLOCKED',
    });
    expect(activePresentationSession()).toBeNull();
  });

  it('document becoming PERSONAL during build requires current acknowledgement', async () => {
    const { document } = await createOperationalDocumentFromFile(
      { uri: 'file:///tmp/picker/cdl.jpg', mimeType: 'image/jpeg', name: 'x.jpg' },
      { documentKind: 'CUSTOM', title: 'Agreement', sensitivity: 'STANDARD' },
      deps(),
    );
    wrapVerify(() => {
      useRoadWalletStore
        .getState()
        .updateDocumentMetadata(document.id, { sensitivity: 'PERSONAL_SENSITIVE' }, deps().ctx());
    });
    await expect(buildQuickPresentSession(roadside(document.id, false), deps())).rejects.toMatchObject({
      reason: 'PERSONAL_ACK_REQUIRED',
    });
    const withAck = await buildQuickPresentSession(roadside(document.id, true), deps());
    expect(withAck.items).toHaveLength(1);
    destroyPresentationSession();
  });

  it('v1 → v2 replacement during build never mints a stale v1 session', async () => {
    const created = await addDoc();
    const v1 = created.version.id;
    fileStore.addSource('file:///tmp/picker/cdl2.jpg', JPEG, 'image/jpeg');
    wrapVerify(async () => {
      await replaceOperationalDocumentFile(
        created.document.id,
        { uri: 'file:///tmp/picker/cdl2.jpg', mimeType: 'image/jpeg', name: 'y.jpg' },
        deps(),
      );
    });
    const session = await buildQuickPresentSession(roadside(created.document.id), deps());
    const currentId = useRoadWalletStore
      .getState()
      .versions.filter((v) => v.operationalDocumentId === created.document.id)
      .sort((a, b) => b.versionNumber - a.versionNumber)[0]?.id;
    expect(session.items[0]?.exactVersionId).toBe(currentId);
    expect(session.items[0]?.exactVersionId).not.toBe(v1);
  });

  it('AppState: background before build, during build, and after presenting', async () => {
    const { document } = await addDoc();
    let activity: 'active' | 'background' = 'background';
    const withActivity = () => ({ ...deps(), appActivity: () => activity });
    await expect(buildQuickPresentSession(roadside(document.id), withActivity())).rejects.toMatchObject({
      reason: 'APP_BACKGROUNDED',
    });
    expect(activePresentationSession()).toBeNull();

    activity = 'active';
    wrapVerify(() => {
      activity = 'background';
    });
    await expect(buildQuickPresentSession(roadside(document.id), withActivity())).rejects.toMatchObject({
      reason: 'APP_BACKGROUNDED',
    });
    expect(activePresentationSession()).toBeNull();

    activity = 'active';
    const session = await buildQuickPresentSession(roadside(document.id), withActivity());
    expect(activePresentationSession()?.id).toBe(session.id);
    destroyPresentationSession();
    expect(activePresentationSession()).toBeNull();
  });

  it('Pass 3-H0: production deps expose live AppState; test deps stay injectable', () => {
    const production = defaultPresentationSetDeps();
    expect(production.appActivity).toEqual(expect.any(Function));
    const live = production.appActivity?.();
    const raw = AppState.currentState;
    if (raw === 'active' || raw === 'inactive' || raw === 'background') {
      expect(live).toBe(raw);
    } else {
      expect(live).toBe('unknown');
    }
    let activity: 'active' | 'background' = 'background';
    const injected = { ...deps(), appActivity: () => activity };
    expect(injected.appActivity()).toBe('background');
    activity = 'active';
    expect(injected.appActivity()).toBe('active');
  });
});

describe('Pass 2.1 H7 — Quick Present PDF share confirmation', () => {
  it('STANDARD PDF uses NONE; PERSONAL requires an independent share ack; FINANCIAL stays blocked; Free cannot share', async () => {
    const standard = await createOperationalDocumentFromFile(
      { uri: 'file:///tmp/picker/coi.pdf', mimeType: 'application/pdf', name: 'coi.pdf' },
      { documentKind: 'CERTIFICATE_OF_INSURANCE', title: 'COI' },
      deps(),
    );
    await shareOperationalDocumentVersion(
      { documentId: standard.document.id, sensitiveConfirmation: 'NONE' },
      deps(),
    );
    expect(fileStore.shared).toHaveLength(1);

    const personal = await createOperationalDocumentFromFile(
      { uri: 'file:///tmp/picker/coi.pdf', mimeType: 'application/pdf', name: 'med.pdf' },
      { documentKind: 'MEDICAL_DOCUMENT', title: 'Med card' },
      deps(),
    );
    await expect(
      shareOperationalDocumentVersion(
        { documentId: personal.document.id, sensitiveConfirmation: 'NONE' },
        deps(),
      ),
    ).rejects.toMatchObject({ reason: 'CONFIRMATION_REQUIRED' });
    expect(fileStore.shared).toHaveLength(1);
    await shareOperationalDocumentVersion(
      { documentId: personal.document.id, sensitiveConfirmation: 'PERSONAL_ACKNOWLEDGED' },
      deps(),
    );
    expect(fileStore.shared).toHaveLength(2);

    const financial = await createOperationalDocumentFromFile(
      { uri: 'file:///tmp/picker/coi.pdf', mimeType: 'application/pdf', name: 'w9.pdf' },
      { documentKind: 'W9', title: 'W-9' },
      deps(),
    );
    await expect(
      shareOperationalDocumentVersion(
        { documentId: financial.document.id, sensitiveConfirmation: 'PERSONAL_ACKNOWLEDGED' },
        deps(),
      ),
    ).rejects.toMatchObject({ reason: 'CONFIRMATION_REQUIRED' });
    await expect(
      buildQuickPresentSession(
        {
          setId: 'system:shipper',
          setKind: 'SYSTEM_SHIPPER',
          setName: 'Shipper',
          documentIds: [financial.document.id],
          personalAcknowledged: true,
        },
        deps(),
      ),
    ).rejects.toMatchObject({ reason: 'FINANCIAL_BLOCKED' });

    setTier('free');
    await expect(
      shareOperationalDocumentVersion(
        { documentId: standard.document.id, sensitiveConfirmation: 'NONE' },
        deps(),
      ),
    ).rejects.toMatchObject({ reason: 'NOT_ENTITLED' });
  });
});
