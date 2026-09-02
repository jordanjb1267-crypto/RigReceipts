import { canUseFeature, Feature, Tier } from './entitlements';

/**
 * Cloud-sync authorization + local-only semantics (Refinement C1).
 *
 * `authenticated != cloud_backup_entitled`. Every remote effect (upload, row
 * insert) must pass {@link authorizeCloudSync}, which checks — in order — that
 * Supabase is configured, a user is signed in, the current tier includes the
 * relevant cloud capability, and the content is bound to that same user.
 *
 * Content that cannot sync is never dropped: it is labelled `local_only` and
 * stays on the device. Entitlement or account changes only ever move records
 * between `local_only` and `pending_sync`; `synced` is terminal.
 */

/** Cloud capabilities are a named subset of the software feature gates. */
export type CloudCapability = Extract<Feature, 'cloudBackup' | 'cloudDocumentBackup'>;

/**
 * Generic cloud state for any locally retained record (captures, Road Wallet
 * documents and versions). `synced` is terminal for immutable content.
 */
export type CloudSyncStatus = 'local_only' | 'pending_sync' | 'synced';
/** Backwards-compatible alias kept for the capture queue (C1). */
export type CaptureSyncStatus = CloudSyncStatus;

export interface CloudSyncContext {
  userId: string | null;
  tier: Tier;
  supabaseConfigured: boolean;
}

export type CloudSyncDenial =
  'not_configured' | 'signed_out' | 'not_entitled' | 'unowned_content' | 'owner_mismatch';

export type CloudSyncDecision =
  | { allowed: true; userId: string; reason: null }
  | { allowed: false; userId: null; reason: CloudSyncDenial };

const deny = (reason: CloudSyncDenial): CloudSyncDecision => ({
  allowed: false,
  userId: null,
  reason,
});

/**
 * Whether the current session may use a cloud capability at all (no content
 * involved). Used to decide the initial state of newly created content.
 */
export function cloudCapabilityAvailable(
  ctx: CloudSyncContext,
  capability: CloudCapability,
): CloudSyncDecision {
  if (!ctx.supabaseConfigured) return deny('not_configured');
  if (!ctx.userId) return deny('signed_out');
  if (!canUseFeature(ctx.tier, capability)) return deny('not_entitled');
  return { allowed: true, userId: ctx.userId, reason: null };
}

/**
 * Whether a specific piece of content may produce a remote effect right now.
 * Content with no owner binding (legacy) is never claimed for whichever account
 * is signed in; content bound to another user never uploads under this one.
 */
export function authorizeCloudSync(
  ctx: CloudSyncContext,
  capability: CloudCapability,
  contentOwnerId: string | null | undefined,
): CloudSyncDecision {
  const session = cloudCapabilityAvailable(ctx, capability);
  if (!session.allowed) return session;
  if (!contentOwnerId) return deny('unowned_content');
  if (contentOwnerId !== session.userId) return deny('owner_mismatch');
  return session;
}

/** Owner binding + initial sync state for content created in this session. */
export interface SyncBinding {
  accountOwnerId: string | null;
  status: Extract<CaptureSyncStatus, 'local_only' | 'pending_sync'>;
}

export function syncBindingFor(ctx: CloudSyncContext, capability: CloudCapability): SyncBinding {
  const decision = cloudCapabilityAvailable(ctx, capability);
  return {
    // A capture created while signed in is bound to that user even when the
    // tier does not (yet) permit backup, so a later upgrade can sync it.
    accountOwnerId: ctx.userId,
    status: decision.allowed ? 'pending_sync' : 'local_only',
  };
}

export interface SyncableRecord {
  status: CaptureSyncStatus;
  accountOwnerId: string | null;
}

/**
 * Value-level rule shared by every record type: `synced` is terminal for
 * immutable content; anything else is `pending_sync` exactly when this session
 * may upload it, otherwise `local_only`.
 */
export function reconcileCloudStatus(
  current: CloudSyncStatus,
  ctx: CloudSyncContext,
  capability: CloudCapability,
  contentOwnerId: string | null | undefined,
): CloudSyncStatus {
  if (current === 'synced') return 'synced';
  return authorizeCloudSync(ctx, capability, contentOwnerId).allowed
    ? 'pending_sync'
    : 'local_only';
}

/**
 * Re-derives the sync state of one unsynced record from the current context.
 * `synced` is terminal and untouched. Everything else is `pending_sync` exactly
 * when this session is authorized to upload it, otherwise `local_only`. Pure:
 * never deletes, never rebinds ownership.
 */
export function reconcileSyncStatus<T extends SyncableRecord>(
  record: T,
  ctx: CloudSyncContext,
  capability: CloudCapability,
): T {
  const next = reconcileCloudStatus(record.status, ctx, capability, record.accountOwnerId);
  return next === record.status ? record : { ...record, status: next };
}

/**
 * Cloud status of *editable* metadata right after a local mutation. Unlike an
 * immutable version, edited metadata is never terminal: it must sync again if
 * this session may, otherwise it is honestly local-only.
 */
export function statusAfterLocalMutation(
  ctx: CloudSyncContext,
  capability: CloudCapability,
  contentOwnerId: string | null | undefined,
): Extract<CloudSyncStatus, 'local_only' | 'pending_sync'> {
  return authorizeCloudSync(ctx, capability, contentOwnerId).allowed
    ? 'pending_sync'
    : 'local_only';
}

/** Short user-facing label for a sync state (CSV export, list rows). */
export function captureSyncLabel(status: CloudSyncStatus): string {
  switch (status) {
    case 'synced':
      return 'yes';
    case 'pending_sync':
      return 'pending';
    case 'local_only':
      return 'local';
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}
