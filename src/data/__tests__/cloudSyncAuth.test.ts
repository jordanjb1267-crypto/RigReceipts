import {
  assertRemoteEffectAuthorized,
  authorizeRemoteEffect,
  bindingForNewContent,
  cloudCapabilityAllowed,
  CloudSyncDeniedError,
  currentCloudSyncContext,
  subscribeCloudSyncContext,
} from '@/data/cloudSyncAuth';
import { useAuthStore } from '@/store/auth';
import { useSubscriptionStore } from '@/store/subscription';

const ENV_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const ENV_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

const configure = (on: boolean) => {
  if (on) {
    process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'anon';
  } else {
    delete process.env.EXPO_PUBLIC_SUPABASE_URL;
    delete process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  }
};

const signIn = (userId: string | null) =>
  useAuthStore.setState({ userId, status: userId ? 'signed_in' : 'signed_out', session: null });

beforeEach(() => {
  configure(true);
  signIn(null);
  useSubscriptionStore.getState().setTier('free');
});

afterAll(() => {
  if (ENV_URL) process.env.EXPO_PUBLIC_SUPABASE_URL = ENV_URL;
  else delete process.env.EXPO_PUBLIC_SUPABASE_URL;
  if (ENV_KEY) process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = ENV_KEY;
  else delete process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
});

describe('currentCloudSyncContext', () => {
  it('reads live auth, subscription and configuration state', () => {
    expect(currentCloudSyncContext()).toEqual({
      userId: null,
      tier: 'free',
      supabaseConfigured: true,
    });
    signIn('user-a');
    useSubscriptionStore.getState().setTier('owner_operator');
    configure(false);
    expect(currentCloudSyncContext()).toEqual({
      userId: 'user-a',
      tier: 'owner_operator',
      supabaseConfigured: false,
    });
  });
});

describe('the runtime boundary', () => {
  it('signed out -> denied, and new content is unowned local_only', () => {
    expect(cloudCapabilityAllowed('cloudBackup').reason).toBe('signed_out');
    expect(bindingForNewContent('cloudBackup')).toEqual({
      accountOwnerId: null,
      status: 'local_only',
    });
    expect(() => assertRemoteEffectAuthorized('cloudBackup', 'user-a')).toThrow(
      CloudSyncDeniedError,
    );
  });

  it('signed-in Free -> denied (authenticated != entitled), content bound but local_only', () => {
    signIn('user-a');
    expect(cloudCapabilityAllowed('cloudBackup').reason).toBe('not_entitled');
    expect(bindingForNewContent('cloudBackup')).toEqual({
      accountOwnerId: 'user-a',
      status: 'local_only',
    });
    try {
      assertRemoteEffectAuthorized('cloudBackup', 'user-a');
      throw new Error('expected denial');
    } catch (e) {
      expect(e).toBeInstanceOf(CloudSyncDeniedError);
      expect((e as CloudSyncDeniedError).reason).toBe('not_entitled');
      expect((e as CloudSyncDeniedError).capability).toBe('cloudBackup');
    }
  });

  it('signed-in Driver Pro -> allowed for own content, returns the user id', () => {
    signIn('user-a');
    useSubscriptionStore.getState().setTier('driver_pro');
    expect(cloudCapabilityAllowed('cloudBackup').allowed).toBe(true);
    expect(bindingForNewContent('cloudBackup')).toEqual({
      accountOwnerId: 'user-a',
      status: 'pending_sync',
    });
    expect(assertRemoteEffectAuthorized('cloudBackup', 'user-a')).toBe('user-a');
  });

  it("refuses User A's content under User B and refuses unowned content", () => {
    signIn('user-b');
    useSubscriptionStore.getState().setTier('driver_pro');
    expect(authorizeRemoteEffect('cloudBackup', 'user-a').reason).toBe('owner_mismatch');
    expect(authorizeRemoteEffect('cloudBackup', null).reason).toBe('unowned_content');
    expect(() => assertRemoteEffectAuthorized('cloudBackup', 'user-a')).toThrow(/owner_mismatch/);
  });

  it('denies everything when Supabase is not configured (device-only mode)', () => {
    configure(false);
    signIn('user-a');
    useSubscriptionStore.getState().setTier('lifetime');
    expect(authorizeRemoteEffect('cloudBackup', 'user-a').reason).toBe('not_configured');
  });

  it('keeps cloudBackup and cloudDocumentBackup as distinct capabilities', () => {
    signIn('user-a');
    useSubscriptionStore.getState().setTier('driver_pro');
    const a = assertRemoteEffectAuthorized('cloudBackup', 'user-a');
    const b = assertRemoteEffectAuthorized('cloudDocumentBackup', 'user-a');
    expect(a).toBe('user-a');
    expect(b).toBe('user-a');
    try {
      useSubscriptionStore.getState().setTier('free');
      assertRemoteEffectAuthorized('cloudDocumentBackup', 'user-a');
      throw new Error('expected denial');
    } catch (e) {
      expect((e as CloudSyncDeniedError).capability).toBe('cloudDocumentBackup');
    }
  });
});

describe('subscribeCloudSyncContext', () => {
  it('fires on sign-in/out and on tier changes, not on unrelated updates', () => {
    const seen: string[] = [];
    const unsub = subscribeCloudSyncContext((ctx) => seen.push(`${ctx.userId}:${ctx.tier}`));

    signIn('user-a');
    useSubscriptionStore.getState().setTier('driver_pro');
    useSubscriptionStore.getState().recordUse('rate_check');
    useAuthStore.setState({ status: 'signed_in' });
    signIn(null);
    unsub();
    useSubscriptionStore.getState().setTier('lifetime');

    expect(seen).toEqual(['user-a:free', 'user-a:driver_pro', 'null:driver_pro']);
  });
});
