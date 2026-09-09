/**
 * Product wall-clock for derived attention / urgency only.
 *
 * React purity lint forbids `Date.now()` during render, and set-state-in-effect
 * forbids refreshing React state from an effect body. The live clock therefore
 * lives in an external store: module init is a real current time (never epoch
 * 0), and subscribers refresh it asynchronously. This clock never writes
 * receivable status or any financial record.
 */

import { useSyncExternalStore } from 'react';

type Listener = () => void;

const listeners = new Set<Listener>();
let capturedNowMs = Date.now();

function emit(): void {
  for (const listener of listeners) listener();
}

export function readProductNowMs(): number {
  return capturedNowMs;
}

export function captureProductNowMs(nowMs: number): number {
  if (!Number.isFinite(nowMs)) {
    throw new Error('captureProductNowMs requires a finite nowMs');
  }
  if (capturedNowMs === nowMs) return capturedNowMs;
  capturedNowMs = nowMs;
  emit();
  return capturedNowMs;
}

function subscribeProductNow(listener: Listener): () => void {
  listeners.add(listener);
  const id = setTimeout(() => {
    captureProductNowMs(Date.now());
  }, 0);
  return () => {
    clearTimeout(id);
    listeners.delete(listener);
  };
}

/** Live product temporal reference. The clock is refreshed outside render. */
export function useProductNowMs(): number {
  return useSyncExternalStore(subscribeProductNow, readProductNowMs, readProductNowMs);
}
