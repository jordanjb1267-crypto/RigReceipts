import { scanTypeToExpenseCategory } from '@/domain';
import { getSupabaseClient, isSupabaseConfigured } from '@/lib/supabase';
import { useAuthStore } from '@/store/auth';
import { Capture, useCapturesStore } from '@/store/captures';

/**
 * Syncs the offline capture queue to Supabase: uploads the image to the private
 * `receipts` bucket (per-user folder), records a `document_scans` row, and — for
 * captures with an amount and a mappable category — an `expenses` row linked to
 * the scan. All owner-scoped by RLS. Failures leave a capture `pending_sync` for
 * the next attempt, so nothing is lost offline.
 */

const RECEIPTS_BUCKET = 'receipts';
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

async function uploadCaptureImage(userId: string, capture: Capture): Promise<string | null> {
  if (!capture.imageUri) return null;
  const path = storagePathFor(userId, capture.id, capture.imageUri);
  // RN-safe: read the local file as an ArrayBuffer and upload it.
  const arrayBuffer = await fetch(capture.imageUri).then((res) => res.arrayBuffer());
  const { error } = await getSupabaseClient()
    .storage.from(RECEIPTS_BUCKET)
    .upload(path, arrayBuffer, { contentType: contentTypeForPath(path), upsert: true });
  if (error) throw error;
  return path;
}

/**
 * Syncs one capture. Returns the remote `document_scans` id (or null when the
 * capture had no image to store). Throws on any failure so the caller can keep
 * the capture pending.
 */
export async function syncCapture(userId: string, capture: Capture): Promise<string | null> {
  const supabase = getSupabaseClient();

  let scanId: string | null = null;
  const path = await uploadCaptureImage(userId, capture);
  if (path) {
    const { data, error } = await supabase
      .from('document_scans')
      .insert({
        owner_id: userId,
        scan_type: capture.scanType,
        storage_path: path,
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

  const category = scanTypeToExpenseCategory(capture.scanType);
  if (category && capture.totalUsd !== null) {
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

let inFlight = false;

/**
 * Syncs every `pending_sync` capture for the signed-in user, flipping each to
 * `synced` on success. Guarded against concurrent runs; a per-capture failure
 * leaves that capture pending without blocking the others.
 */
export async function syncPendingCaptures(userId: string): Promise<number> {
  if (inFlight) return 0;
  inFlight = true;
  try {
    const pending = useCapturesStore.getState().captures.filter((c) => c.status === 'pending_sync');
    let synced = 0;
    for (const capture of pending) {
      try {
        const remoteScanId = await syncCapture(userId, capture);
        useCapturesStore.getState().markSynced(capture.id, remoteScanId);
        synced++;
      } catch {
        // Leave pending; the next backfill retries.
      }
    }
    return synced;
  } finally {
    inFlight = false;
  }
}

let started = false;

/**
 * Backfills the capture queue whenever a user is signed in — once at startup and
 * again on every auth change. No-op without Supabase (device-only mode).
 */
export function initCaptureSync(): void {
  if (started || !isSupabaseConfigured()) return;
  started = true;

  const run = () => {
    const userId = useAuthStore.getState().userId;
    if (userId) void syncPendingCaptures(userId);
  };

  run();
  useAuthStore.subscribe((state) => {
    if (state.userId) void syncPendingCaptures(state.userId);
  });
}
