import { ANALYTICS_EVENTS, AnalyticsEvent } from './events';

/**
 * Thin analytics facade. A real provider (PostHog) is a later phase; for now
 * this validates event names, attaches shared context, and logs in dev.
 *
 * Privacy: never pass document contents, OCR text, addresses, contacts, or
 * amounts tied to a person. Props should be low-cardinality context only.
 */

export interface AnalyticsContext {
  role?: string;
  equipmentType?: string;
  entrySource?: string;
  subscriptionTier?: string;
  /** Flag name → enabled, for the flags relevant to the event. */
  flagState?: Record<string, boolean>;
}

export type AnalyticsProps = Record<string, string | number | boolean | null | undefined>;

type Sink = (event: AnalyticsEvent, props: AnalyticsProps) => void;

let context: AnalyticsContext = {};
let sink: Sink = (event, props) => {
  if (__DEV__) {
    console.log(`[analytics] ${event}`, props);
  }
};

/** Swap in a real provider adapter (e.g. PostHog) later. */
export function setAnalyticsSink(next: Sink): void {
  sink = next;
}

export function setAnalyticsContext(next: AnalyticsContext): void {
  context = { ...context, ...next };
}

const EVENT_SET = new Set<string>(ANALYTICS_EVENTS);

/** Validates the event name, merges context, and forwards to the sink. */
export function track(event: AnalyticsEvent, props: AnalyticsProps = {}): void {
  if (!EVENT_SET.has(event)) {
    if (__DEV__) {
      console.warn(`[analytics] unknown event: ${event}`);
    }
    return;
  }
  const { flagState, ...flatContext } = context;
  sink(event, { ...flatContext, ...flagState, ...props });
}

export { ANALYTICS_EVENTS } from './events';
export type { AnalyticsEvent } from './events';
