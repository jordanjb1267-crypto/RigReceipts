import {
  CloudSyncContext,
  newOpaqueId,
  readySnapshotMatchesSharedTransition,
  STANDARD_BROKER_PACKET,
} from '@/domain';
import { useAuthStore } from '@/store/auth';
import { useCarrierPacketsStore } from '@/store/carrierPackets';
import { useCarrierProfileStore } from '@/store/carrierProfile';
import { useRoadWalletStore } from '@/store/roadWallet';
import { useSubscriptionStore } from '@/store/subscription';

import { saveCarrierProfile } from '../carrierProfile';
import {
  archiveCustomCarrierTemplate,
  createCarrierPacketDraft,
  createCustomCarrierTemplate,
  createUpdatedCarrierPacket,
  liveReviewCarrierPacket,
  markCarrierPacketReady,
  markCarrierPacketShared,
  packetItems,
  refreshCarrierPacketItem,
  removeOptionalCarrierPacketItem,
  returnCarrierPacketToDraft,
  setCarrierPacketItemDocument,
  shareCarrierPacketItem,
  updateCustomCarrierTemplate,
} from '../carrierPackets';
import { MemoryDocumentFileStore } from '../documentFiles';
import {
  configureRoadWalletFileStore,
  createOperationalDocumentFromFile,
  replaceOperationalDocumentFile,
} from '../roadWallet';

const PDF = new TextEncoder().encode('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n');

let fileStore: MemoryDocumentFileStore;
let seed = 0;
const nextId = () => {
  seed++;
  const s = seed;
  return newOpaqueId(() => new Uint8Array(Array.from({ length: 16 }, (_, i) => (i * 29 + s * 7) & 0xff)));
};

const signIn = (userId: string | null) =>
  useAuthStore.setState({ userId, status: userId ? 'signed_in' : 'signed_out', session: null });
const setTier = (tier: 'free' | 'driver_pro' | 'owner_operator' | 'lifetime' | 'fleet_lite') =>
  useSubscriptionStore.getState().setTier(tier);

const deps = () => ({
  fileStore,
  ctx: (): CloudSyncContext => ({
    userId: useAuthStore.getState().userId,
    tier: useSubscriptionStore.getState().tier,
    supabaseConfigured: true,
  }),
  now: () => 11_000,
  newId: nextId,
});

const packetDeps = () => ({ ctx: deps().ctx, now: deps().now, newId: nextId });

beforeEach(() => {
  useCarrierPacketsStore.getState().clear();
  useCarrierProfileStore.getState().clear();
  useRoadWalletStore.getState().clear();
  fileStore = new MemoryDocumentFileStore();
  fileStore.addSource('file:///tmp/picker/w9.pdf', PDF, 'application/pdf');
  fileStore.addSource('file:///tmp/picker/coi.pdf', PDF, 'application/pdf');
  fileStore.addSource('file:///tmp/picker/auth.pdf', PDF, 'application/pdf');
  fileStore.addSource('file:///tmp/picker/w9b.pdf', PDF, 'application/pdf');
  fileStore.addSource('file:///tmp/picker/w9c.pdf', PDF, 'application/pdf');
  fileStore.addSource('file:///tmp/picker/noa.pdf', PDF, 'application/pdf');
  configureRoadWalletFileStore(fileStore);
  signIn('user-a');
  setTier('owner_operator');
  seed = 0;
});

afterAll(() => configureRoadWalletFileStore(null));

const addKind = (kind: 'W9' | 'CERTIFICATE_OF_INSURANCE' | 'OPERATING_AUTHORITY', uri: string) =>
  createOperationalDocumentFromFile(
    { uri, mimeType: 'application/pdf', name: 'x.pdf' },
    { documentKind: kind, title: kind },
    deps(),
  );

describe('profile + packet assembly', () => {
  it('Free/Driver cannot mutate; Owner can create one profile and a DRAFT snapshot', async () => {
    setTier('free');
    expect(() => saveCarrierProfile({ legalName: 'Nope', equipmentTypes: [] }, packetDeps())).toThrow(
      /NOT_ENTITLED/,
    );
    setTier('driver_pro');
    expect(() => createCarrierPacketDraft({ source: { kind: 'BUILTIN' } }, packetDeps())).toThrow(
      /NOT_ENTITLED/,
    );
    setTier('owner_operator');
    const profile = saveCarrierProfile(
      { legalName: 'Acme Hauling', usdotNumber: '1', mcNumber: '2', equipmentTypes: [] },
      packetDeps(),
    );
    expect(profile.identitySource).toBe('USER_ENTERED');
    expect(profile).not.toHaveProperty('ein');
    const w9 = await addKind('W9', 'file:///tmp/picker/w9.pdf');
    const coi = await addKind('CERTIFICATE_OF_INSURANCE', 'file:///tmp/picker/coi.pdf');
    const auth = await addKind('OPERATING_AUTHORITY', 'file:///tmp/picker/auth.pdf');
    const packet = createCarrierPacketDraft({ source: { kind: 'BUILTIN' } }, packetDeps());
    expect(packet.status).toBe('DRAFT');
    expect(packet.templateSnapshot.name).toBe(STANDARD_BROKER_PACKET.name);
    expect(packet.profileSnapshot?.legalName).toBe('Acme Hauling');
    const items = packetItems(packet.id);
    expect(items.find((i) => i.operationalDocumentId === w9.document.id)?.documentVersionId).toBe(
      w9.version.id,
    );
    expect(items.find((i) => i.operationalDocumentId === coi.document.id)).toBeTruthy();
    expect(items.find((i) => i.operationalDocumentId === auth.document.id)).toBeTruthy();
    expect(JSON.stringify(items)).not.toMatch(/sha256|remoteStoragePath|byteSize/);
  });

  it('v1→v2 leaves the packet on v1 until an explicit DRAFT refresh', async () => {
    saveCarrierProfile({ legalName: 'Acme', equipmentTypes: [] }, packetDeps());
    const w9 = await addKind('W9', 'file:///tmp/picker/w9.pdf');
    await addKind('CERTIFICATE_OF_INSURANCE', 'file:///tmp/picker/coi.pdf');
    await addKind('OPERATING_AUTHORITY', 'file:///tmp/picker/auth.pdf');
    const packet = createCarrierPacketDraft({ source: { kind: 'BUILTIN' } }, packetDeps());
    const before = packetItems(packet.id).find((i) => i.operationalDocumentId === w9.document.id)!;
    const v2 = await replaceOperationalDocumentFile(
      w9.document.id,
      { uri: 'file:///tmp/picker/w9b.pdf', mimeType: 'application/pdf', name: 'y.pdf' },
      deps(),
    );
    const still = packetItems(packet.id).find((i) => i.operationalDocumentId === w9.document.id)!;
    expect(still.documentVersionId).toBe(before.documentVersionId);
    expect(still.documentVersionId).not.toBe(v2.id);
    const review = liveReviewCarrierPacket(packet.id, packetDeps());
    expect(review.blockers.some((f) => f.code === 'STALE_VERSION')).toBe(true);
    refreshCarrierPacketItem(packet.id, still.requirementKey, packetDeps());
    const refreshed = packetItems(packet.id).find((i) => i.requirementKey === still.requirementKey)!;
    expect(refreshed.id).toBe(still.id);
    expect(refreshed.documentVersionId).toBe(v2.id);
  });

  it('replacing the selected document preserves the requirement item id', async () => {
    saveCarrierProfile({ legalName: 'Acme', equipmentTypes: [] }, packetDeps());
    const w9a = await addKind('W9', 'file:///tmp/picker/w9.pdf');
    const w9b = await createOperationalDocumentFromFile(
      { uri: 'file:///tmp/picker/w9c.pdf', mimeType: 'application/pdf', name: 'z.pdf' },
      { documentKind: 'W9', title: 'W9-B' },
      deps(),
    );
    await addKind('CERTIFICATE_OF_INSURANCE', 'file:///tmp/picker/coi.pdf');
    await addKind('OPERATING_AUTHORITY', 'file:///tmp/picker/auth.pdf');
    const packet = createCarrierPacketDraft({ source: { kind: 'BUILTIN' } }, packetDeps());
    const first = setCarrierPacketItemDocument(packet.id, 'w9', w9a.document.id, packetDeps());
    const second = setCarrierPacketItemDocument(packet.id, 'w9', w9b.document.id, packetDeps());
    expect(second.id).toBe(first.id);
    expect(second.operationalDocumentId).toBe(w9b.document.id);
    expect(second.documentVersionId).toBe(w9b.version.id);
    expect(second.documentVersionId).not.toBe(first.documentVersionId);
  });
});

describe('status + share + mark shared', () => {
  const seedReady = async () => {
    saveCarrierProfile({ legalName: 'Acme', usdotNumber: '1', mcNumber: '2', equipmentTypes: [] }, packetDeps());
    await addKind('W9', 'file:///tmp/picker/w9.pdf');
    await addKind('CERTIFICATE_OF_INSURANCE', 'file:///tmp/picker/coi.pdf');
    await addKind('OPERATING_AUTHORITY', 'file:///tmp/picker/auth.pdf');
    return createCarrierPacketDraft({ source: { kind: 'BUILTIN' } }, packetDeps());
  };

  it('cannot jump DRAFT→SHARED; READY needs zero blockers; return-to-draft and SHARED attestation work', async () => {
    const packet = await seedReady();
    expect(() =>
      markCarrierPacketShared({ packetId: packet.id, confirmed: true }, packetDeps()),
    ).toThrow(/NOT_READY/);
    const ready = markCarrierPacketReady(packet.id, packetDeps());
    expect(ready.status).toBe('READY');
    const beforeReturn = useCarrierPacketsStore.getState().packets.find((p) => p.id === ready.id)!;
    const readyItems = packetItems(ready.id);
    const draft = returnCarrierPacketToDraft(ready.id, packetDeps());
    expect(draft.status).toBe('DRAFT');
    expect(draft.readyAt).toBeNull();
    const proof = useCarrierPacketsStore.getState().readyReturnProofFor(ready.id, 'user-a');
    expect(proof?.readyPacketEvidence.status).toBe('READY');
    expect(proof?.readyPacketEvidence.readyAt).toBe(beforeReturn.readyAt);
    expect(proof?.readyItemsEvidence).toHaveLength(readyItems.length);
    const readyAgain = markCarrierPacketReady(draft.id, packetDeps());
    expect(() =>
      markCarrierPacketShared({ packetId: readyAgain.id, confirmed: false }, packetDeps()),
    ).toThrow(/CONFIRMATION_REQUIRED/);
    const shared = markCarrierPacketShared(
      { packetId: readyAgain.id, confirmed: true, recipientLabel: 'Broker Co', shareMethod: 'OTHER' },
      packetDeps(),
    );
    expect(shared.status).toBe('SHARED');
    expect(shared.sharedAt).toBeTruthy();
    expect(shared.recipientLabel).toBe('Broker Co');
    expect(() =>
      setCarrierPacketItemDocument(shared.id, 'w9', packetItems(shared.id)[0]!.operationalDocumentId, packetDeps()),
    ).toThrow(/DRAFT/);
    const updated = createUpdatedCarrierPacket(shared.id, packetDeps());
    expect(updated.status).toBe('DRAFT');
    expect(updated.supersedesPacketId).toBe(shared.id);
    expect(useCarrierPacketsStore.getState().packets.find((p) => p.id === shared.id)?.status).toBe(
      'SHARED',
    );
  });

  it('markCarrierPacketShared emits only the READY→SHARED share-time delta', async () => {
    const packet = await seedReady();
    const ready = markCarrierPacketReady(packet.id, packetDeps());
    const shared = markCarrierPacketShared(
      {
        packetId: ready.id,
        confirmed: true,
        recipientLabel: 'Broker Co',
        shareMethod: 'OS_SHARE_SHEET',
      },
      packetDeps(),
    );
    expect(readySnapshotMatchesSharedTransition(ready, shared)).toBe(true);
    expect(shared.status).toBe('SHARED');
    expect(shared.sharedAt).not.toBeNull();
    expect(shared.shareMethod).toBe('OS_SHARE_SHEET');
    expect(shared.recipientLabel).toBe('Broker Co');
    expect(shared.name).toBe(ready.name);
    expect(shared.templateSnapshot).toEqual(ready.templateSnapshot);
    expect(shared.profileSnapshot).toEqual(ready.profileSnapshot);
    expect(shared.readyAt).toBe(ready.readyAt);
    expect(shared.createdAt).toBe(ready.createdAt);
    expect(shared.supersedesPacketId).toBe(ready.supersedesPacketId);
    expect(shared.id).toBe(ready.id);
  });

  it('item share requires READY and does not mark SHARED; Driver is denied; financial needs FINANCIAL ack', async () => {
    const packet = await seedReady();
    const item = packetItems(packet.id).find((i) => i.requirementKey === 'w9')!;
    await expect(
      shareCarrierPacketItem(
        { packetId: packet.id, itemId: item.id, sensitiveConfirmation: 'FINANCIAL_ACKNOWLEDGED' },
        packetDeps(),
      ),
    ).rejects.toMatchObject({ reason: 'NOT_READY' });
    markCarrierPacketReady(packet.id, packetDeps());
    await expect(
      shareCarrierPacketItem(
        { packetId: packet.id, itemId: item.id, sensitiveConfirmation: 'NONE' },
        packetDeps(),
      ),
    ).rejects.toMatchObject({ reason: 'CONFIRMATION_REQUIRED' });
    const sharedFile = await shareCarrierPacketItem(
      { packetId: packet.id, itemId: item.id, sensitiveConfirmation: 'FINANCIAL_ACKNOWLEDGED' },
      packetDeps(),
    );
    expect(sharedFile.versionId).toBe(item.documentVersionId);
    expect(useCarrierPacketsStore.getState().packets.find((p) => p.id === packet.id)?.status).toBe(
      'READY',
    );
    await shareCarrierPacketItem(
      {
        packetId: packet.id,
        itemId: packetItems(packet.id).find((i) => i.requirementKey === 'coi')!.id,
        sensitiveConfirmation: 'NONE',
      },
      packetDeps(),
    );
    expect(useCarrierPacketsStore.getState().packets.find((p) => p.id === packet.id)?.status).toBe(
      'READY',
    );
    setTier('driver_pro');
    expect(() => markCarrierPacketReady(packet.id, packetDeps())).toThrow(/NOT_ENTITLED/);
  });

  it('profile change after READY blocks mark-shared until return-to-draft refresh', async () => {
    const packet = await seedReady();
    markCarrierPacketReady(packet.id, packetDeps());
    saveCarrierProfile({ legalName: 'Renamed LLC', usdotNumber: '1', mcNumber: '2', equipmentTypes: [] }, packetDeps());
    expect(() =>
      markCarrierPacketShared({ packetId: packet.id, confirmed: true }, packetDeps()),
    ).toThrow(/BLOCKED/);
    const item = packetItems(packet.id).find((i) => i.requirementKey === 'w9')!;
    await expect(
      shareCarrierPacketItem(
        { packetId: packet.id, itemId: item.id, sensitiveConfirmation: 'FINANCIAL_ACKNOWLEDGED' },
        packetDeps(),
      ),
    ).rejects.toMatchObject({ reason: 'BLOCKED' });
  });

  it('stale packet version cannot be shared until return-to-draft refresh', async () => {
    const packet = await seedReady();
    const w9Item = packetItems(packet.id).find((i) => i.requirementKey === 'w9')!;
    markCarrierPacketReady(packet.id, packetDeps());
    const w9DocId = w9Item.operationalDocumentId;
    await replaceOperationalDocumentFile(
      w9DocId,
      { uri: 'file:///tmp/picker/w9b.pdf', mimeType: 'application/pdf', name: 'y.pdf' },
      deps(),
    );
    await expect(
      shareCarrierPacketItem(
        { packetId: packet.id, itemId: w9Item.id, sensitiveConfirmation: 'FINANCIAL_ACKNOWLEDGED' },
        packetDeps(),
      ),
    ).rejects.toMatchObject({ reason: 'STALE_VERSION' });
    expect(() =>
      markCarrierPacketShared({ packetId: packet.id, confirmed: true }, packetDeps()),
    ).toThrow(/BLOCKED/);
  });

  it('successor SHARED supersedes the predecessor; SHARED contents stay frozen', async () => {
    const packet = await seedReady();
    const ready = markCarrierPacketReady(packet.id, packetDeps());
    const shared = markCarrierPacketShared(
      { packetId: ready.id, confirmed: true, shareMethod: 'OTHER' },
      packetDeps(),
    );
    const snapshotItems = packetItems(shared.id).map((i) => i.documentVersionId);
    const updated = createUpdatedCarrierPacket(shared.id, packetDeps());
    expect(updated.supersedesPacketId).toBe(shared.id);
    markCarrierPacketReady(updated.id, packetDeps());
    markCarrierPacketShared({ packetId: updated.id, confirmed: true }, packetDeps());
    expect(useCarrierPacketsStore.getState().packets.find((p) => p.id === shared.id)?.status).toBe(
      'SUPERSEDED',
    );
    expect(packetItems(shared.id).map((i) => i.documentVersionId)).toEqual(snapshotItems);
  });
});

describe('account scope + templates + entitlements', () => {
  it('User A cannot see User B; unowned is not auto-claimed; downgrade preserves', () => {
    const a = saveCarrierProfile({ legalName: 'A Haul', equipmentTypes: [] }, packetDeps());
    signIn('user-b');
    expect(useCarrierProfileStore.getState().profiles.find((p) => p.id === a.id)?.accountOwnerId).toBe(
      'user-a',
    );
    const visibleB = useCarrierProfileStore
      .getState()
      .profiles.filter((p) => p.accountOwnerId === useAuthStore.getState().userId);
    expect(visibleB).toHaveLength(0);
    const b = saveCarrierProfile({ legalName: 'B Haul', equipmentTypes: [] }, packetDeps());
    expect(b.id).not.toBe(a.id);
    signIn(null);
    const unowned = saveCarrierProfile({ legalName: 'Signed out', equipmentTypes: [] }, packetDeps());
    expect(unowned.accountOwnerId).toBeNull();
    signIn('user-a');
    expect(
      useCarrierProfileStore.getState().profiles.find((p) => p.id === unowned.id)?.accountOwnerId,
    ).toBeNull();
    setTier('free');
    expect(useCarrierProfileStore.getState().profiles.find((p) => p.id === a.id)?.legalName).toBe(
      'A Haul',
    );
    expect(() => saveCarrierProfile({ legalName: 'Nope', equipmentTypes: [] }, packetDeps())).toThrow(
      /NOT_ENTITLED/,
    );
  });

  it('Lifetime and Fleet may build packets; custom template edits do not mutate existing snapshots', async () => {
    for (const tier of ['lifetime', 'fleet_lite'] as const) {
      useCarrierPacketsStore.getState().clear();
      useCarrierProfileStore.getState().clear();
      useRoadWalletStore.getState().clear();
      setTier(tier);
      saveCarrierProfile({ legalName: 'Acme', equipmentTypes: [] }, packetDeps());
      await addKind('W9', 'file:///tmp/picker/w9.pdf');
      await addKind('CERTIFICATE_OF_INSURANCE', 'file:///tmp/picker/coi.pdf');
      await addKind('OPERATING_AUTHORITY', 'file:///tmp/picker/auth.pdf');
      const packet = createCarrierPacketDraft({ source: { kind: 'BUILTIN' } }, packetDeps());
      expect(packet.status).toBe('DRAFT');
    }
    setTier('owner_operator');
    const template = createCustomCarrierTemplate(
      {
        name: 'Mine',
        definition: {
          schemaVersion: 1,
          requireCarrierProfile: true,
          documentRequirements: [
            {
              key: 'w9',
              documentKind: 'W9',
              label: 'W-9',
              required: true,
              position: 0,
            },
            {
              key: 'bank',
              documentKind: 'BANKING_DOCUMENT',
              label: 'Banking',
              required: false,
              position: 1,
            },
          ],
        },
      },
      packetDeps(),
    );
    const packet = createCarrierPacketDraft(
      { source: { kind: 'CUSTOM', id: template.id } },
      packetDeps(),
    );
    const frozen = JSON.stringify(packet.templateSnapshot);
    updateCustomCarrierTemplate(
      template.id,
      {
        name: 'Renamed',
        definition: {
          schemaVersion: 1,
          name: 'Renamed',
          requireCarrierProfile: true,
          documentRequirements: [
            {
              key: 'coi',
              documentKind: 'CERTIFICATE_OF_INSURANCE',
              label: 'COI',
              required: true,
              position: 0,
            },
          ],
        },
      },
      packetDeps(),
    );
    expect(JSON.stringify(useCarrierPacketsStore.getState().packets.find((p) => p.id === packet.id)?.templateSnapshot)).toBe(
      frozen,
    );
    archiveCustomCarrierTemplate(template.id, packetDeps());
    expect(useCarrierPacketsStore.getState().templates.find((t) => t.id === template.id)?.lifecycle).toBe(
      'ARCHIVED',
    );
    expect(useCarrierPacketsStore.getState().templates.find((t) => t.id === template.id)).toBeTruthy();
    setTier('driver_pro');
    expect(() =>
      createCustomCarrierTemplate(
        {
          name: 'No',
          definition: {
            schemaVersion: 1,
            requireCarrierProfile: true,
            documentRequirements: [],
          },
        },
        packetDeps(),
      ),
    ).toThrow(/NOT_ENTITLED/);
  });
});

describe('Pass 3.1 — draft membership + packet-context share', () => {
  it('optional removal is DRAFT-only; required/READY/SHARED are denied', async () => {
    saveCarrierProfile({ legalName: 'Acme', usdotNumber: '1', mcNumber: '2', equipmentTypes: [] }, packetDeps());
    await addKind('W9', 'file:///tmp/picker/w9.pdf');
    await addKind('CERTIFICATE_OF_INSURANCE', 'file:///tmp/picker/coi.pdf');
    await addKind('OPERATING_AUTHORITY', 'file:///tmp/picker/auth.pdf');
    const noa = await createOperationalDocumentFromFile(
      { uri: 'file:///tmp/picker/noa.pdf', mimeType: 'application/pdf', name: 'n.pdf' },
      { documentKind: 'FACTORING_NOA', title: 'NOA' },
      deps(),
    );
    const packet = createCarrierPacketDraft({ source: { kind: 'BUILTIN' } }, packetDeps());
    setCarrierPacketItemDocument(packet.id, 'factoring', noa.document.id, packetDeps());
    expect(packetItems(packet.id).some((i) => i.requirementKey === 'factoring')).toBe(true);
    expect(() => removeOptionalCarrierPacketItem(packet.id, 'w9', packetDeps())).toThrow(/REQUIRED/);
    removeOptionalCarrierPacketItem(packet.id, 'factoring', packetDeps());
    expect(packetItems(packet.id).some((i) => i.requirementKey === 'factoring')).toBe(false);
    markCarrierPacketReady(packet.id, packetDeps());
    expect(() => removeOptionalCarrierPacketItem(packet.id, 'factoring', packetDeps())).toThrow(/DRAFT/);
    markCarrierPacketShared({ packetId: packet.id, confirmed: true }, packetDeps());
    expect(() => removeOptionalCarrierPacketItem(packet.id, 'factoring', packetDeps())).toThrow(/DRAFT/);
  });

  it('any live packet blocker prevents packet-context share, including another required item', async () => {
    saveCarrierProfile({ legalName: 'Acme', usdotNumber: '1', mcNumber: '2', equipmentTypes: [] }, packetDeps());
    const w9 = await addKind('W9', 'file:///tmp/picker/w9.pdf');
    await addKind('CERTIFICATE_OF_INSURANCE', 'file:///tmp/picker/coi.pdf');
    await addKind('OPERATING_AUTHORITY', 'file:///tmp/picker/auth.pdf');
    const packet = createCarrierPacketDraft({ source: { kind: 'BUILTIN' } }, packetDeps());
    markCarrierPacketReady(packet.id, packetDeps());
    await replaceOperationalDocumentFile(
      w9.document.id,
      { uri: 'file:///tmp/picker/w9b.pdf', mimeType: 'application/pdf', name: 'y.pdf' },
      deps(),
    );
    const coi = packetItems(packet.id).find((i) => i.requirementKey === 'coi')!;
    await expect(
      shareCarrierPacketItem(
        { packetId: packet.id, itemId: coi.id, sensitiveConfirmation: 'NONE' },
        packetDeps(),
      ),
    ).rejects.toMatchObject({ reason: 'STALE_VERSION' });
  });

  it('return-to-draft or account switch during verification prevents the share sheet', async () => {
    saveCarrierProfile({ legalName: 'Acme', usdotNumber: '1', mcNumber: '2', equipmentTypes: [] }, packetDeps());
    await addKind('W9', 'file:///tmp/picker/w9.pdf');
    await addKind('CERTIFICATE_OF_INSURANCE', 'file:///tmp/picker/coi.pdf');
    await addKind('OPERATING_AUTHORITY', 'file:///tmp/picker/auth.pdf');
    const packet = createCarrierPacketDraft({ source: { kind: 'BUILTIN' } }, packetDeps());
    markCarrierPacketReady(packet.id, packetDeps());
    const item = packetItems(packet.id).find((i) => i.requirementKey === 'coi')!;
    const orig = fileStore.verify.bind(fileStore);
    fileStore.verify = async (path, opts) => {
      returnCarrierPacketToDraft(packet.id, packetDeps());
      return orig(path, opts);
    };
    await expect(
      shareCarrierPacketItem(
        { packetId: packet.id, itemId: item.id, sensitiveConfirmation: 'NONE' },
        packetDeps(),
      ),
    ).rejects.toMatchObject({ reason: 'NOT_READY' });
    fileStore.verify = orig;

    markCarrierPacketReady(packet.id, packetDeps());
    fileStore.verify = async (path, opts) => {
      signIn('user-b');
      return orig(path, opts);
    };
    await expect(
      shareCarrierPacketItem(
        { packetId: packet.id, itemId: item.id, sensitiveConfirmation: 'NONE' },
        packetDeps(),
      ),
    ).rejects.toMatchObject({ reason: 'NOT_VISIBLE' });
    fileStore.verify = orig;
    signIn('user-a');

    fileStore.verify = async (path, opts) => {
      setTier('driver_pro');
      return orig(path, opts);
    };
    await expect(
      shareCarrierPacketItem(
        { packetId: packet.id, itemId: item.id, sensitiveConfirmation: 'NONE' },
        packetDeps(),
      ),
    ).rejects.toMatchObject({ reason: 'NOT_ENTITLED' });
    fileStore.verify = orig;
    setTier('owner_operator');
    expect(useCarrierPacketsStore.getState().packets.find((p) => p.id === packet.id)?.status).toBe(
      'READY',
    );
  });
});
