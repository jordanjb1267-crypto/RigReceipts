import { ShareDeniedError } from '@/data/roadWallet';
import { RestoreError } from '@/data/roadWalletRecovery';

/**
 * User-facing copy for Road Wallet failures. Never echoes internal exception
 * text, private paths or hashes; never claims a compliance outcome.
 */

export function saveErrorCopy(err: unknown): string {
  const msg = err instanceof Error ? err.message : '';
  if (/EMPTY/.test(msg)) return 'That file is empty. Choose a different photo or file.';
  if (/CONTENT_MISMATCH/.test(msg)) {
    return 'That file does not look like the type it claims to be. Choose the original photo or PDF.';
  }
  if (/source (file )?(missing|not found)/i.test(msg)) {
    return 'The selected file is no longer available. Pick it again.';
  }
  if (/same account/.test(msg)) return 'That truck belongs to a different account.';
  if (/masked/.test(msg)) return 'Enter only the last four characters of the document number.';
  if (/YYYY-MM-DD/.test(msg)) return 'Dates must be entered as YYYY-MM-DD.';
  if (/secure random/i.test(msg)) return 'Secure storage is unavailable on this device right now.';
  if (/not visible/.test(msg)) return 'This document belongs to a different account.';
  return 'The document could not be saved. Nothing was stored — try again.';
}

export function restoreErrorCopy(err: unknown): string {
  if (err instanceof RestoreError) {
    switch (err.reason) {
      case 'SIGNED_OUT':
        return 'Sign in to the account that backed this document up to restore it.';
      case 'NOT_CONFIGURED':
        return 'Cloud recovery is not available in this build.';
      case 'NOT_FOUND':
      case 'NOT_VISIBLE':
        return 'This document is not available in the current account.';
      case 'NO_VERSION':
        return 'This document has no stored file to restore.';
      case 'NOT_BACKED_UP':
        return 'This version was never backed up, so there is nothing to restore from the cloud.';
      case 'REMOTE_PATH_INVALID':
        return 'The backup record for this version is not valid. Replace the document to save a fresh copy.';
      case 'DOWNLOAD_FAILED':
        return 'The backup could not be downloaded. Check your connection and try again.';
      case 'BYTES_MISMATCH':
      case 'VERIFY_FAILED':
        return 'The downloaded file did not match the saved version, so it was not kept. Replace the document to save a fresh copy.';
      case 'WRITE_FAILED':
        return 'The file could not be written to this device. Free up space and try again.';
      case 'SESSION_CHANGED':
        return 'The signed-in account changed during the restore. Nothing was saved.';
      default: {
        const exhaustive: never = err.reason;
        return exhaustive;
      }
    }
  }
  return 'The document could not be restored. Nothing was changed — try again.';
}

export function shareErrorCopy(err: unknown): { title: string; body: string } {
  if (err instanceof ShareDeniedError) {
    switch (err.reason) {
      case 'NOT_ENTITLED':
        return {
          title: 'Share/Export is part of Driver Pro',
          body: 'Your wallet keeps working on this device. Driver Pro adds one-tap Share/Export.',
        };
      case 'NOT_VISIBLE':
      case 'NOT_FOUND':
        return {
          title: 'Document unavailable',
          body: 'This document is not available in the current account.',
        };
      case 'ARCHIVED':
        return { title: 'Document is archived', body: 'Restore the document before sharing it.' };
      case 'NO_VERSION':
        return { title: 'No file to share', body: 'This document has no stored file yet.' };
      case 'CONFIRMATION_REQUIRED':
        return {
          title: 'Confirmation needed',
          body: 'Confirm the sensitive-document notice before sharing.',
        };
      case 'FILE_UNAVAILABLE':
        return {
          title: err.fileError === 'MISSING' ? 'File is unavailable' : 'File has changed',
          body:
            err.fileError === 'MISSING'
              ? 'The stored copy of this document is missing on this device. Replace the document or restore a verified copy before sharing.'
              : 'The stored file no longer matches the saved version. Replace the document with a fresh photo or file before sharing.',
        };
      case 'SHARE_UNAVAILABLE':
        return {
          title: 'Sharing unavailable',
          body: 'This device does not offer a share sheet right now.',
        };
      default: {
        const exhaustive: never = err.reason;
        return exhaustive;
      }
    }
  }
  return {
    title: 'Could not share',
    body: 'Something went wrong before the share sheet opened. Nothing was sent.',
  };
}
