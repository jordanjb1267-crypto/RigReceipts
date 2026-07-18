import type { AnalyticsEvent } from './events';
import type { AnalyticsProps } from './index';

/**
 * PostHog sink for the analytics facade. Talks to PostHog's HTTP `/batch/`
 * capture endpoint directly — no native module, so it stays Hermes-safe,
 * prebuild-free, and unit-testable. Events are queued and flushed in batches;
 * a failed flush requeues (capped) so a brief outage doesn't lose events.
 *
 * Privacy: this only forwards what `track()` already allow-lists (low-cardinality
 * context). The `distinct_id` is the Supabase user id when signed in, or an
 * anonymous device id otherwise — never a name, email, or document content.
 */

const DEFAULT_HOST = 'https://us.i.posthog.com';
const LIB = 'rigreceipts-react-native';

export interface QueuedEvent {
  event: string;
  distinct_id: string;
  properties: Record<string, unknown>;
  timestamp: string;
}

/** The subset of `fetch` the sink uses — keeps it free of the DOM/RN overload. */
export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/**
 * Pure builder for the PostHog `/batch/` request body — no network, no side
 * effects. Stamps `$lib` on every event for source attribution.
 */
export function buildBatchPayload(apiKey: string, events: readonly QueuedEvent[]) {
  return {
    api_key: apiKey,
    batch: events.map((e) => ({
      event: e.event,
      distinct_id: e.distinct_id,
      timestamp: e.timestamp,
      properties: { ...e.properties, $lib: LIB },
    })),
  };
}

export interface PostHogSinkConfig {
  apiKey: string;
  host?: string;
  getDistinctId: () => string;
  /** Flush once the queue reaches this many events. */
  flushAt?: number;
  /** Periodic flush interval in ms; 0 disables the timer (used in tests). */
  flushIntervalMs?: number;
  /** Max events retained across failed flushes before the oldest are dropped. */
  maxQueue?: number;
  fetchImpl?: FetchLike;
  now?: () => Date;
}

export interface PostHogSink {
  capture: (event: AnalyticsEvent, props: AnalyticsProps) => void;
  /** Alias the anonymous id to a real id on sign-in so pre-account events stick. */
  identify: (distinctId: string, anonId: string) => void;
  flush: () => Promise<void>;
}

export function createPostHogSink(config: PostHogSinkConfig): PostHogSink {
  const host = (config.host && config.host.trim() !== '' ? config.host : DEFAULT_HOST).replace(
    /\/+$/,
    '',
  );
  const endpoint = `${host}/batch/`;
  const flushAt = config.flushAt ?? 20;
  const maxQueue = config.maxQueue ?? 100;
  const doFetch = config.fetchImpl ?? fetch;
  const now = config.now ?? (() => new Date());

  let queue: QueuedEvent[] = [];
  let sending = false;

  async function flush(): Promise<void> {
    if (sending || queue.length === 0) return;
    sending = true;
    const batch = queue;
    queue = [];
    try {
      const res = await doFetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildBatchPayload(config.apiKey, batch)),
      });
      if (!res.ok) throw new Error(`posthog batch failed: ${res.status}`);
    } catch {
      // Requeue for the next flush, capped so a long outage can't grow unbounded.
      queue = [...batch, ...queue].slice(0, maxQueue);
    } finally {
      sending = false;
    }
  }

  const enqueue = (e: QueuedEvent) => {
    queue.push(e);
    if (queue.length > maxQueue) queue = queue.slice(queue.length - maxQueue);
    if (queue.length >= flushAt) void flush();
  };

  const capture: PostHogSink['capture'] = (event, props) => {
    // Drop undefined values so they don't serialize as null noise.
    const properties: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(props)) {
      if (value !== undefined) properties[key] = value;
    }
    enqueue({
      event,
      distinct_id: config.getDistinctId(),
      properties,
      timestamp: now().toISOString(),
    });
  };

  const identify: PostHogSink['identify'] = (distinctId, anonId) => {
    enqueue({
      event: '$identify',
      distinct_id: distinctId,
      properties: { $anon_distinct_id: anonId },
      timestamp: now().toISOString(),
    });
  };

  if (config.flushIntervalMs !== 0) {
    const interval = config.flushIntervalMs ?? 15_000;
    const timer = setInterval(() => void flush(), interval);
    // Don't keep the Node event loop alive under tests.
    if (typeof timer === 'object' && timer !== null && 'unref' in timer) {
      (timer as unknown as { unref: () => void }).unref();
    }
  }

  return { capture, identify, flush };
}
