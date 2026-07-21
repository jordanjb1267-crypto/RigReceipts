/**
 * Live Mileage location adapter (build prompt §10–§13, phase F/G).
 *
 * This is the ONLY place GPS touches the mileage store. It converts a stream of
 * device fixes into `appendMiles` calls through the pure accumulator in
 * `@/domain/geo`, so every anti-fabrication rule (gap re-anchoring, jitter
 * rejection, spike rejection) is enforced by tested code — this file only does
 * wiring: permissions, subscriptions, and platform config.
 *
 * Design constraints:
 *  - GPS never asserts freight status. This adapter only accumulates distance
 *    into whatever segment the driver has already confirmed; it never opens,
 *    classifies, or closes a segment (§24).
 *  - Native modules (`expo-location`, `expo-task-manager`) are required lazily
 *    so the JS bundle and Jest never need them present. Foreground tracking is
 *    the V1 path; background tracking is gated behind its own flag and needs a
 *    custom dev client (§11–§12).
 */
import { isFeatureEnabled } from '@/config/flags';
import { AccumulatorState, GeoFix, initialAccumulator, stepAccumulator } from '@/domain';
import { useMileageStore } from '@/store/mileage';

/** Background task identifier — must match the registered TaskManager task. */
export const MILEAGE_LOCATION_TASK = 'rigreceipts.mileage.location';

export type TrackingStartReason =
  | 'started'
  | 'core_disabled'
  | 'background_disabled'
  | 'module_unavailable'
  | 'permission_denied'
  | 'no_active_segment';

export interface TrackingStartResult {
  ok: boolean;
  reason: TrackingStartReason;
}

// ---------------------------------------------------------------------------
// Minimal shapes of the native modules we touch (kept local so the app never
// type-depends on packages that may not be installed in every environment).
// ---------------------------------------------------------------------------

interface LocationCoordsLike {
  latitude: number;
  longitude: number;
  accuracy?: number | null;
}
interface LocationObjectLike {
  coords: LocationCoordsLike;
  timestamp: number;
}
interface LocationSubscriptionLike {
  remove: () => void;
}
interface PermissionResponseLike {
  status: string;
  granted?: boolean;
}
interface LocationModule {
  Accuracy: { BestForNavigation: number } & Record<string, number>;
  ActivityType?: Record<string, number>;
  requestForegroundPermissionsAsync(): Promise<PermissionResponseLike>;
  requestBackgroundPermissionsAsync(): Promise<PermissionResponseLike>;
  watchPositionAsync(
    options: Record<string, unknown>,
    callback: (location: LocationObjectLike) => void,
  ): Promise<LocationSubscriptionLike>;
  startLocationUpdatesAsync(task: string, options: Record<string, unknown>): Promise<void>;
  stopLocationUpdatesAsync(task: string): Promise<void>;
  hasStartedLocationUpdatesAsync(task: string): Promise<boolean>;
}

interface TaskManagerModule {
  defineTask(
    task: string,
    handler: (body: { data?: { locations?: LocationObjectLike[] }; error?: unknown }) => void,
  ): void;
}

function loadLocation(): LocationModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('expo-location');
    return (mod.default ?? mod) as LocationModule;
  } catch {
    return null;
  }
}

function loadTaskManager(): TaskManagerModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('expo-task-manager');
    return (mod.default ?? mod) as TaskManagerModule;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Fix ingestion — the pure accumulator feeds the store. Exported + resettable
// so the wiring is unit-testable without a GPS radio.
// ---------------------------------------------------------------------------

let accumulator: AccumulatorState = initialAccumulator();
let subscription: LocationSubscriptionLike | null = null;

export function resetTracking(): void {
  accumulator = initialAccumulator();
}

function toFix(loc: LocationObjectLike): GeoFix {
  return {
    lat: loc.coords.latitude,
    lng: loc.coords.longitude,
    accuracyMeters: loc.coords.accuracy ?? null,
    timestampMs: loc.timestamp,
  };
}

/**
 * Fold one fix into the accumulator and add any accepted miles to the active
 * segment. Returns the miles added (0 when the fix was rejected or there is no
 * active segment). `appendMiles` itself no-ops when nothing is active, so GPS
 * running without a confirmed segment can never invent classified miles.
 */
export function ingestFix(fix: GeoFix): number {
  const step = stepAccumulator(accumulator, fix);
  accumulator = step.state;
  if (step.deltaMiles > 0) {
    useMileageStore.getState().appendMiles(step.deltaMiles);
  }
  return step.deltaMiles;
}

function watchOptions(location: LocationModule): Record<string, unknown> {
  return {
    accuracy: location.Accuracy.BestForNavigation,
    distanceInterval: 15, // meters between callbacks — coarse enough to save battery
    timeInterval: 5000, // ms
  };
}

// ---------------------------------------------------------------------------
// Foreground tracking — the V1 path (works in a dev/production build without
// background entitlements).
// ---------------------------------------------------------------------------

export async function startForegroundTracking(): Promise<TrackingStartResult> {
  if (!isFeatureEnabled('live_mileage_core_enabled')) {
    return { ok: false, reason: 'core_disabled' };
  }
  const Location = loadLocation();
  if (!Location) return { ok: false, reason: 'module_unavailable' };

  const perm = await Location.requestForegroundPermissionsAsync();
  if (perm.status !== 'granted') return { ok: false, reason: 'permission_denied' };

  await stopForegroundTracking();
  resetTracking();
  subscription = await Location.watchPositionAsync(watchOptions(Location), (loc) =>
    ingestFix(toFix(loc)),
  );
  return { ok: true, reason: 'started' };
}

export async function stopForegroundTracking(): Promise<void> {
  if (subscription) {
    subscription.remove();
    subscription = null;
  }
}

// ---------------------------------------------------------------------------
// Background tracking — gated behind its own flag; needs a custom dev client,
// Always authorization (iOS) / ACCESS_BACKGROUND_LOCATION + a foreground
// service (Android). Kept device-gated until the §18 QA matrix passes.
// ---------------------------------------------------------------------------

let backgroundTaskDefined = false;

/**
 * Register the background location task handler. Call once at app startup when
 * background tracking is enabled — TaskManager requires the task be defined
 * before the OS can deliver background fixes.
 */
export function defineBackgroundMileageTask(): void {
  if (backgroundTaskDefined) return;
  if (!isFeatureEnabled('background_mileage_tracking_enabled')) return;
  const TaskManager = loadTaskManager();
  if (!TaskManager) return;
  TaskManager.defineTask(MILEAGE_LOCATION_TASK, ({ data, error }) => {
    if (error || !data?.locations) return;
    for (const loc of data.locations) {
      ingestFix(toFix(loc));
    }
  });
  backgroundTaskDefined = true;
}

export async function startBackgroundTracking(): Promise<TrackingStartResult> {
  if (!isFeatureEnabled('live_mileage_core_enabled')) {
    return { ok: false, reason: 'core_disabled' };
  }
  if (!isFeatureEnabled('background_mileage_tracking_enabled')) {
    return { ok: false, reason: 'background_disabled' };
  }
  const Location = loadLocation();
  if (!Location) return { ok: false, reason: 'module_unavailable' };

  const fg = await Location.requestForegroundPermissionsAsync();
  if (fg.status !== 'granted') return { ok: false, reason: 'permission_denied' };
  const bg = await Location.requestBackgroundPermissionsAsync();
  if (bg.status !== 'granted') return { ok: false, reason: 'permission_denied' };

  defineBackgroundMileageTask();
  resetTracking();
  await Location.startLocationUpdatesAsync(MILEAGE_LOCATION_TASK, {
    accuracy: Location.Accuracy.BestForNavigation,
    distanceInterval: 15,
    timeInterval: 5000,
    pausesUpdatesAutomatically: false,
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: 'RigReceipts is tracking miles',
      notificationBody: 'Loaded and deadhead miles are being measured for this trip.',
    },
  });
  return { ok: true, reason: 'started' };
}

export async function stopBackgroundTracking(): Promise<void> {
  const Location = loadLocation();
  if (!Location) return;
  try {
    const started = await Location.hasStartedLocationUpdatesAsync(MILEAGE_LOCATION_TASK);
    if (started) await Location.stopLocationUpdatesAsync(MILEAGE_LOCATION_TASK);
  } catch {
    // No task running / module not fully linked — nothing to stop.
  }
}
