import {
  authorizeCloudSync,
  CloudCapability,
  cloudCapabilityAvailable,
  CloudSyncContext,
  CloudSyncDecision,
  CloudSyncDenial,
  SyncBinding,
  syncBindingFor,
} from '@/domain';
import { isSupabaseConfigured } from '@/lib/supabase';
import { useAuthStore } from '@/store/auth';
import { useSubscriptionStore } from '@/store/subscription';

/**
 * The single runtime authorization boundary for every remote cloud effect
 * (Refinement C1). UI gating is advisory only; callers that touch Supabase must
 * call {@link assertRemoteEffectAuthorized} immediately before each upload or
 * row write so the decision reflects the live auth + subscription state, and so
 * a future caller cannot bypass the rule by skipping a screen.
 *
 * Capabilities stay distinct: the receipt/capture queue syncs under
 * `cloudBackup`; Road Wallet (later pass) will sync under `cloudDocumentBackup`.
 */

/** Live snapshot of the inputs the authorization rule depends on. */
export function currentCloudSyncContext(): CloudSyncContext {
  return {
    userId: useAuthStore.getState().userId,
    tier: useSubscriptionStore.getState().tier,
    supabaseConfigured: isSupabaseConfigured(),
  };
}

export class CloudSyncDeniedError extends Error {
  readonly reason: CloudSyncDenial;
  readonly capability: CloudCapability;

  constructor(capability: CloudCapability, reason: CloudSyncDenial) {
    super(`cloud sync denied (${capability}): ${reason}`);
    this.name = 'CloudSyncDeniedError';
    this.reason = reason;
    this.capability = capability;
  }
}

/** Session-level check (no content): may this session use the capability? */
export function cloudCapabilityAllowed(
  capability: CloudCapability,
  ctx: CloudSyncContext = currentCloudSyncContext(),
): CloudSyncDecision {
  return cloudCapabilityAvailable(ctx, capability);
}

/** Content-level check: may this session upload content owned by `contentOwnerId`? */
export function authorizeRemoteEffect(
  capability: CloudCapability,
  contentOwnerId: string | null | undefined,
  ctx: CloudSyncContext = currentCloudSyncContext(),
): CloudSyncDecision {
  return authorizeCloudSync(ctx, capability, contentOwnerId);
}

/**
 * Throwing variant for the effect boundary. Returns the authenticated user id
 * that the remote write must be scoped to.
 */
export function assertRemoteEffectAuthorized(
  capability: CloudCapability,
  contentOwnerId: string | null | undefined,
  ctx: CloudSyncContext = currentCloudSyncContext(),
): string {
  const decision = authorizeRemoteEffect(capability, contentOwnerId, ctx);
  if (!decision.allowed) throw new CloudSyncDeniedError(capability, decision.reason);
  return decision.userId;
}

/** Owner binding + initial state for content created right now. */
export function bindingForNewContent(
  capability: CloudCapability,
  ctx: CloudSyncContext = currentCloudSyncContext(),
): SyncBinding {
  return syncBindingFor(ctx, capability);
}

/**
 * Notifies `listener` whenever any authorization input changes (sign-in/out,
 * tier change). Returns an unsubscribe function.
 */
export function subscribeCloudSyncContext(listener: (ctx: CloudSyncContext) => void): () => void {
  const notify = () => listener(currentCloudSyncContext());
  const unsubAuth = useAuthStore.subscribe((s, prev) => {
    if (s.userId !== prev.userId) notify();
  });
  const unsubTier = useSubscriptionStore.subscribe((s, prev) => {
    if (s.tier !== prev.tier) notify();
  });
  return () => {
    unsubAuth();
    unsubTier();
  };
}
