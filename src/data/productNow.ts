/**
 * Product wall-clock for derived attention / urgency only.
 *
 * React purity lint forbids `Date.now()` during render, and set-state-in-effect
 * forbids refreshing React state from an effect body. The live clock therefore
 * lives in an external store.
 *
 * Freshness (shared, refcounted — not a per-hook scheduler):
 *   1. Module init is a real current time (never epoch 0).
 *   2. While any subscriber is attached, one AppState listener refreshes on
 *      foreground/active (same RN API Quick Present already uses).
 *   3. While any subscriber is attached, one chained timeout refreshes on a
 *      1-hour cadence. Aging is day-scale (`floor(ms / 86_400_000)`); this is
 *      not a visible clock. One hourly timeout bounds foreground lag after a
 *      calendar-day crossing without a display-rate timer.
 *
 * Refresh only updates this temporal reference and notifies derived views.
 * It never writes receivable status, LoadStatus, financial records, or network.
 */

import { useSyncExternalStore } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

type Listener = () => void;

/** Low-cost foreground cadence. Not a real-time display clock. */
export const PRODUCT_NOW_FOREGROUND_CADENCE_MS = 3_600_000;

const listeners = new Set<Listener>();
let capturedNowMs = Date.now();
let appStateSub: { remove: () => void } | null = null;
let cadenceTimer: ReturnType<typeof setTimeout> | null = null;
let immediateTimer: ReturnType<typeof setTimeout> | null = null;

function emit(): void {
  for (const listener of listeners) listener();
}

function wallClockMs(): number {
  return Date.now();
}

function refreshFromWallClock(): void {
  captureProductNowMs(wallClockMs());
}

function armCadence(): void {
  if (cadenceTimer !== null) return;
  cadenceTimer = setTimeout(() => {
    cadenceTimer = null;
    if (listeners.size === 0) return;
    refreshFromWallClock();
    armCadence();
  }, PRODUCT_NOW_FOREGROUND_CADENCE_MS);
}

function onAppStateChange(next: AppStateStatus): void {
  if (next === 'active') refreshFromWallClock();
}

function ensureSharedRefresh(): void {
  if (!appStateSub) {
    appStateSub = AppState.addEventListener('change', onAppStateChange);
  }
  armCadence();
  if (immediateTimer === null) {
    immediateTimer = setTimeout(() => {
      immediateTimer = null;
      if (listeners.size === 0) return;
      refreshFromWallClock();
    }, 0);
  }
}

function tearDownIfIdle(): void {
  if (listeners.size > 0) return;
  if (cadenceTimer !== null) {
    clearTimeout(cadenceTimer);
    cadenceTimer = null;
  }
  if (immediateTimer !== null) {
    clearTimeout(immediateTimer);
    immediateTimer = null;
  }
  if (appStateSub) {
    appStateSub.remove();
    appStateSub = null;
  }
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

/** Subscribe to clock updates. Shared AppState + cadence start on first listener. */
export function subscribeProductNow(listener: Listener): () => void {
  listeners.add(listener);
  ensureSharedRefresh();
  return () => {
    listeners.delete(listener);
    tearDownIfIdle();
  };
}

export function inspectProductNowScheduler(): {
  subscribers: number;
  cadenceArmed: boolean;
  appStateAttached: boolean;
  immediateArmed: boolean;
} {
  return {
    subscribers: listeners.size,
    cadenceArmed: cadenceTimer !== null,
    appStateAttached: appStateSub !== null,
    immediateArmed: immediateTimer !== null,
  };
}

/** Test helper — drops listeners and shared scheduling. Does not write product stores. */
export function resetProductNowSchedulerForTests(): void {
  listeners.clear();
  tearDownIfIdle();
}

/** Live product temporal reference. The clock is refreshed outside render. */
export function useProductNowMs(): number {
  return useSyncExternalStore(subscribeProductNow, readProductNowMs, readProductNowMs);
}
