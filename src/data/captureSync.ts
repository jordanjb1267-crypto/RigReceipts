import { bucketForScanType, scanTypeToExpenseCategory, StorageBucket } from '@/domain';
import { getSupabaseClient } from '@/lib/supabase';
import { Capture, CAPTURE_CLOUD_CAPABILITY, NewCapture, useCapturesStore } from '@/store/captures';

import {
  assertRemoteEffectAuthorized,
  authorizeRemoteEffect,
  bindingForNewContent,
  CloudSyncDeniedError,
  currentCloudSyncContext,
  subscribeCloudSyncContext,
} from './cloudSyncAuth';

/**
 * Syncs the offline capture queue to Supabase: uploads the image to the private
 * bucket chosen by the storage class of the scan type (C2), records a
 * `document_scans` row that names the bucket actually used, and — for captures
 * with an amount and a mappable category — an `expenses` row linked to the scan.
 * All owner-scoped by RLS.
 *
 * Authorization (C1) is re-checked at the boundary of every remote effect via
 * {@link assertRemoteEffectAuthorized}: signed in, entitled to `cloudBackup`,
 * Supabase configured, and the capture bound to the signed-in user. A denial
 * never deletes anything — the capture is relabelled `local_only` and stays on
 * the device. Failures leave a capture `pending_sync` for the next attempt.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Object path for a capture image: `{userId}/{captureId}.{ext}`. */
export function storagePathFor(userId: string, captureId: string, imageUri: string | null): string {
  const match = imageUri?.match(/\.([a-zA-Z0-9]+)(?:\?.*)?$/);
  const ext = (match?.[1] ?? 'jpg').toLowerCase();
  return `${userId}/${captureId}.${ext}`;
}

/** Best-effort content type from a storage path (defaults to JPEG). */
export function contentTypeForPath(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase();
  if (ext === 'png') return 'image/png';
  if (ext === 'heic') return 'image/heic';
  if (ext === 'webp') return 'image/webp';
  return 'image/jpeg';
}

/** A YYYY-MM-DD string if the capture date is one, else undefined (DB default). */
export function normalizedExpenseDate(date: string | null): string | undefined {
  return date && DATE_RE.test(date.trim()) ? date.trim() : undefined;
}

/** Bucket a capture's image is written to (C2 — explicit scan-type classification). */
export function storageBucketForCapture(capture: Pick<Capture, 'scanType'>): StorageBucket {
  return bucketForScanType(capture.scanType);
}

interface UploadedImage {
  bucket: StorageBucket;
  path: string;
}

async function uploadCaptureImage(capture: Capture): Promise<UploadedImage | null> {
  if (!capture.imageUri) return null;
  // Effect boundary #1 — re-checked immediately before the upload.
  const userId = assertRemoteEffectAuthorized(CAPTURE_CLOUD_CAPABILITY, capture.accountOwnerId);
  const bucket = storageBucketForCapture(capture);
  const path = storagePathFor(userId, capture.id, capture.imageUri);
  // RN-safe: read the local file as an ArrayBuffer and upload it.
  const arrayBuffer = await fetch(capture.imageUri).then((res) => res.arrayBuffer());
  const { error } = await getSupabaseClient()
    .storage.from(bucket)
    .upload(path, arrayBuffer, { contentType: contentTypeForPath(path), upsert: true });
  if (error) throw error;
  return { bucket, path };
}

/**
 * Syncs one capture. Returns the remote `document_scans` id (or null when the
 * capture had no image to store). Throws on any failure so the caller can keep
 * the capture pending; throws {@link CloudSyncDeniedError} when this session may
 * not upload it.
 */
export async function syncCapture(capture: Capture): Promise<string | null> {
  const supabase = getSupabaseClient();

  let scanId: string | null = null;
  const uploaded = await uploadCaptureImage(capture);
  if (uploaded) {
    // Effect boundary #2 — re-checked immediately before the row write.
    const userId = assertRemoteEffectAuthorized(CAPTURE_CLOUD_CAPABILITY, capture.accountOwnerId);
    const { data, error } = await supabase
      .from('document_scans')
      .insert({
        owner_id: userId,
        scan_type: capture.scanType,
        storage_bucket: uploaded.bucket,
        storage_path: uploaded.path,
        ocr_text: capture.rawText || null,
        // The review sheet already required the user to confirm the fields.
        review_status: 'confirmed',
        captured_at: new Date(capture.createdAt).toISOString(),
      })
      .select('id')
      .single();
    if (error) throw error;
    scanId = data.id as string;
  }

  // Accounting classification is independent of storage classification: a
  // permit stored in `documents` still books its expense.
  const category = scanTypeToExpenseCategory(capture.scanType);
  if (category && capture.totalUsd !== null) {
    // Effect boundary #3 — re-checked immediately before the row write.
    const userId = assertRemoteEffectAuthorized(CAPTURE_CLOUD_CAPABILITY, capture.accountOwnerId);
    const { error } = await supabase.from('expenses').insert({
      owner_id: userId,
      amount_usd: capture.totalUsd,
      vendor: capture.vendor,
      expense_date: normalizedExpenseDate(capture.date),
      category_slug: category,
      scan_id: scanId,
      notes: capture.gallons !== null ? `Gallons: ${capture.gallons}` : null,
    });
    if (error) throw error;
  }

  return scanId;
}

/**
 * Saves a new capture from the Scan review sheet with the correct owner binding
 * and initial sync state, then attempts an immediate best-effort upload when
 * the state is `pending_sync`. Returns the new capture id.
 */
export function createCapture(draft: NewCapture): string {
  const store = useCapturesStore.getState();
  const binding = bindingForNewContent(CAPTURE_CLOUD_CAPABILITY);
  const id = store.addCapture(draft, binding);
  if (binding.status === 'pending_sync') {
    const capture = useCapturesStore.getState().captures.find((c) => c.id === id);
    if (capture) {
      syncCapture(capture)
        .then((remoteScanId) => useCapturesStore.getState().markSynced(id, remoteScanId))
        .catch(() => {
          // Left pending (or relabelled by the next reconcile); the backfill retries.
        });
    }
  }
  return id;
}

let inFlight = false;
let rerunRequested = false;

/**
 * Syncs every `pending_sync` capture this session is authorized to upload,
 * flipping each to `synced` on success. Authorization is re-evaluated for every
 * capture (not once before the loop) so a sign-out or downgrade mid-run stops
 * further uploads; denied captures are relabelled `local_only`, never removed.
 * Guarded against concurrent runs; a context change during a run schedules one
 * follow-up pass so no transition is missed.
 */
export async function syncPendingCaptures(): Promise<number> {
  if (inFlight) {
    rerunRequested = true;
    return 0;
  }
  inFlight = true;
  let synced = 0;
  try {
    const store = useCapturesStore.getState();
    store.reconcileSyncStates(currentCloudSyncContext());
    const pending = useCapturesStore.getState().captures.filter((c) => c.status === 'pending_sync');

    for (const capture of pending) {
      const decision = authorizeRemoteEffect(CAPTURE_CLOUD_CAPABILITY, capture.accountOwnerId);
      if (!decision.allowed) {
        useCapturesStore.getState().reconcileSyncStates(currentCloudSyncContext());
        continue;
      }
      try {
        const remoteScanId = await syncCapture(capture);
        useCapturesStore.getState().markSynced(capture.id, remoteScanId);
        synced++;
      } catch (err) {
        if (err instanceof CloudSyncDeniedError) {
          useCapturesStore.getState().reconcileSyncStates(currentCloudSyncContext());
        }
        // Otherwise leave pending; the next backfill retries.
      }
    }
    return synced;
  } finally {
    inFlight = false;
    if (rerunRequested) {
      rerunRequested = false;
      void syncPendingCaptures();
    }
  }
}

let started = false;

/**
 * Keeps capture sync state honest and backfills whenever the authorization
 * inputs change: once at startup (after the persisted queue hydrates), on every
 * auth change, and on every subscription-tier change — so a matching user's
 * `local_only` content becomes eligible after an upgrade, and pending content
 * returns to `local_only` after a downgrade or sign-out. Works in device-only
 * mode too (everything reconciles to `local_only`; no remote calls are made).
 */
export function initCaptureSync(): void {
  if (started) return;
  started = true;

  const run = () => {
    void syncPendingCaptures();
  };

  if (useCapturesStore.persist.hasHydrated()) run();
  useCapturesStore.persist.onFinishHydration(run);
  subscribeCloudSyncContext(run);
}

/** Test-only: resets module state between cases. */
export function __resetCaptureSyncForTests(): void {
  inFlight = false;
  rerunRequested = false;
  started = false;
}
