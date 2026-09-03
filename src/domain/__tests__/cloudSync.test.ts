import {
  authorizeCloudSync,
  captureSyncLabel,
  cloudCapabilityAvailable,
  CloudSyncContext,
  reconcileCloudStatus,
  reconcileSyncStatus,
  statusAfterLocalMutation,
  syncBindingFor,
} from '../cloudSync';
import { Tier } from '../entitlements';

const ctx = (over: Partial<CloudSyncContext> = {}): CloudSyncContext => ({
  userId: 'user-a',
  tier: 'driver_pro',
  supabaseConfigured: true,
  ...over,
});

describe('cloudCapabilityAvailable (session-level rule)', () => {
  it('denies when Supabase is not configured, before anything else', () => {
    expect(cloudCapabilityAvailable(ctx({ supabaseConfigured: false }), 'cloudBackup')).toEqual({
      allowed: false,
      userId: null,
      reason: 'not_configured',
    });
  });

  it('denies signed-out sessions', () => {
    expect(cloudCapabilityAvailable(ctx({ userId: null }), 'cloudBackup').reason).toBe(
      'signed_out',
    );
  });

  it('authenticated != entitled: a signed-in Free user is denied', () => {
    expect(cloudCapabilityAvailable(ctx({ tier: 'free' }), 'cloudBackup').reason).toBe(
      'not_entitled',
    );
    expect(cloudCapabilityAvailable(ctx({ tier: 'free' }), 'cloudDocumentBackup').reason).toBe(
      'not_entitled',
    );
  });

  it('allows every tier from Driver Pro up, returning the user id', () => {
    for (const tier of ['driver_pro', 'owner_operator', 'fleet_lite', 'lifetime'] as Tier[]) {
      expect(cloudCapabilityAvailable(ctx({ tier }), 'cloudBackup')).toEqual({
        allowed: true,
        userId: 'user-a',
        reason: null,
      });
      expect(cloudCapabilityAvailable(ctx({ tier }), 'cloudDocumentBackup').allowed).toBe(true);
    }
  });
});

describe('authorizeCloudSync (content-level rule)', () => {
  it('allows content bound to the signed-in, entitled user', () => {
    expect(authorizeCloudSync(ctx(), 'cloudBackup', 'user-a').allowed).toBe(true);
  });

  it('never claims unowned (legacy) content for whoever is signed in', () => {
    expect(authorizeCloudSync(ctx(), 'cloudBackup', null).reason).toBe('unowned_content');
    expect(authorizeCloudSync(ctx(), 'cloudBackup', undefined).reason).toBe('unowned_content');
  });

  it("never uploads User A's content under User B", () => {
    expect(authorizeCloudSync(ctx({ userId: 'user-b' }), 'cloudBackup', 'user-a').reason).toBe(
      'owner_mismatch',
    );
  });

  it('session denials take precedence over ownership', () => {
    expect(authorizeCloudSync(ctx({ tier: 'free' }), 'cloudBackup', 'user-a').reason).toBe(
      'not_entitled',
    );
    expect(authorizeCloudSync(ctx({ userId: null }), 'cloudBackup', 'user-a').reason).toBe(
      'signed_out',
    );
  });
});

describe('syncBindingFor (new content)', () => {
  it('signed-out content is unowned and local_only', () => {
    expect(syncBindingFor(ctx({ userId: null }), 'cloudBackup')).toEqual({
      accountOwnerId: null,
      status: 'local_only',
    });
  });

  it('signed-in Free content is bound to the user but local_only', () => {
    expect(syncBindingFor(ctx({ tier: 'free' }), 'cloudBackup')).toEqual({
      accountOwnerId: 'user-a',
      status: 'local_only',
    });
  });

  it('signed-in Driver Pro content is bound and pending_sync', () => {
    expect(syncBindingFor(ctx(), 'cloudBackup')).toEqual({
      accountOwnerId: 'user-a',
      status: 'pending_sync',
    });
  });

  it('device-only mode (no Supabase) still binds nothing and stays local', () => {
    expect(syncBindingFor(ctx({ supabaseConfigured: false, userId: null }), 'cloudBackup')).toEqual(
      { accountOwnerId: null, status: 'local_only' },
    );
  });
});

describe('reconcileSyncStatus (state transitions)', () => {
  const owned = { id: 'c1', status: 'local_only' as const, accountOwnerId: 'user-a', note: 'keep' };

  it('promotes owned local_only content to pending_sync once entitled (Free -> Driver Pro)', () => {
    expect(reconcileSyncStatus(owned, ctx({ tier: 'free' }), 'cloudBackup')).toBe(owned);
    expect(reconcileSyncStatus(owned, ctx({ tier: 'driver_pro' }), 'cloudBackup')).toEqual({
      ...owned,
      status: 'pending_sync',
    });
  });

  it('returns pending content to local_only when entitlement is lost before upload', () => {
    const pending = { ...owned, status: 'pending_sync' as const };
    expect(reconcileSyncStatus(pending, ctx({ tier: 'free' }), 'cloudBackup')).toEqual({
      ...pending,
      status: 'local_only',
    });
    expect(reconcileSyncStatus(pending, ctx({ userId: null }), 'cloudBackup').status).toBe(
      'local_only',
    );
  });

  it("keeps User A's pending content local_only while User B is signed in", () => {
    const pending = { ...owned, status: 'pending_sync' as const };
    const r = reconcileSyncStatus(pending, ctx({ userId: 'user-b' }), 'cloudBackup');
    expect(r.status).toBe('local_only');
    expect(r.accountOwnerId).toBe('user-a');
  });

  it('leaves legacy unowned content local_only for every session', () => {
    const legacy = { ...owned, accountOwnerId: null };
    expect(reconcileSyncStatus(legacy, ctx(), 'cloudBackup')).toBe(legacy);
    expect(reconcileSyncStatus(legacy, ctx({ tier: 'lifetime' }), 'cloudBackup').status).toBe(
      'local_only',
    );
  });

  it('synced is terminal — never touched by any context', () => {
    const synced = { ...owned, status: 'synced' as const, remoteScanId: 'r1' };
    for (const c of [ctx(), ctx({ tier: 'free' }), ctx({ userId: null }), ctx({ userId: 'b' })]) {
      expect(reconcileSyncStatus(synced, c, 'cloudBackup')).toBe(synced);
    }
  });

  it('never deletes fields or rebinds ownership', () => {
    const r = reconcileSyncStatus(owned, ctx(), 'cloudBackup');
    expect(r.note).toBe('keep');
    expect(r.id).toBe('c1');
    expect(r.accountOwnerId).toBe('user-a');
  });
});

describe('reconcileCloudStatus / statusAfterLocalMutation (generic, Pass 1A)', () => {
  it('applies the same rule to any record type and keeps synced terminal', () => {
    expect(reconcileCloudStatus('local_only', ctx(), 'cloudDocumentBackup', 'user-a')).toBe(
      'pending_sync',
    );
    expect(
      reconcileCloudStatus('pending_sync', ctx({ tier: 'free' }), 'cloudDocumentBackup', 'user-a'),
    ).toBe('local_only');
    expect(reconcileCloudStatus('local_only', ctx(), 'cloudDocumentBackup', null)).toBe(
      'local_only',
    );
    expect(
      reconcileCloudStatus('synced', ctx({ userId: null }), 'cloudDocumentBackup', 'user-a'),
    ).toBe('synced');
  });

  it('edited metadata is never terminal: pending when authorized, else local_only', () => {
    expect(statusAfterLocalMutation(ctx(), 'cloudDocumentBackup', 'user-a')).toBe('pending_sync');
    expect(statusAfterLocalMutation(ctx({ tier: 'free' }), 'cloudDocumentBackup', 'user-a')).toBe(
      'local_only',
    );
    expect(
      statusAfterLocalMutation(ctx({ userId: 'user-b' }), 'cloudDocumentBackup', 'user-a'),
    ).toBe('local_only');
  });
});

describe('captureSyncLabel', () => {
  it('labels all three states honestly', () => {
    expect(captureSyncLabel('synced')).toBe('yes');
    expect(captureSyncLabel('pending_sync')).toBe('pending');
    expect(captureSyncLabel('local_only')).toBe('local');
  });
});
