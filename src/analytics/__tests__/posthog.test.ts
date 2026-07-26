import { buildBatchPayload, createPostHogSink, QueuedEvent } from '../posthog';

const NOW = new Date('2026-07-18T12:00:00.000Z');
const now = () => NOW;

function okFetch() {
  return jest.fn((_input: string | URL | Request, _init?: RequestInit): Promise<Response> =>
    Promise.resolve({ ok: true, status: 200 } as Response),
  );
}

describe('buildBatchPayload', () => {
  it('wraps events with the api key and stamps $lib', () => {
    const events: QueuedEvent[] = [
      {
        event: 'rate_check_completed',
        distinct_id: 'user-1',
        properties: { equipmentType: 'dry_van' },
        timestamp: NOW.toISOString(),
      },
    ];
    const payload = buildBatchPayload('phc_test', events);
    expect(payload.api_key).toBe('phc_test');
    expect(payload.batch).toHaveLength(1);
    expect(payload.batch[0]).toMatchObject({
      event: 'rate_check_completed',
      distinct_id: 'user-1',
      properties: { equipmentType: 'dry_van', $lib: 'rigreceipts-react-native' },
    });
  });
});

describe('createPostHogSink', () => {
  it('captures and flushes a batch to {host}/batch/ with the distinct id', async () => {
    const fetchImpl = okFetch();
    const sink = createPostHogSink({
      apiKey: 'phc_test',
      host: 'https://eu.i.posthog.com/',
      getDistinctId: () => 'user-1',
      flushIntervalMs: 0,
      fetchImpl,
      now,
    });

    sink.capture('rate_check_completed', { equipmentType: 'dry_van', missing: undefined });
    await sink.flush();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    // Trailing slash on the host is normalized.
    expect(url).toBe('https://eu.i.posthog.com/batch/');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.api_key).toBe('phc_test');
    expect(body.batch[0].distinct_id).toBe('user-1');
    expect(body.batch[0].timestamp).toBe(NOW.toISOString());
    // undefined props are dropped before send.
    expect(body.batch[0].properties).not.toHaveProperty('missing');
    expect(body.batch[0].properties.equipmentType).toBe('dry_van');
  });

  it('auto-flushes once the queue reaches flushAt', async () => {
    const fetchImpl = okFetch();
    const sink = createPostHogSink({
      apiKey: 'phc_test',
      getDistinctId: () => 'anon_1',
      flushAt: 2,
      flushIntervalMs: 0,
      fetchImpl,
      now,
    });

    sink.capture('community_board_viewed', {});
    expect(fetchImpl).not.toHaveBeenCalled();
    sink.capture('community_board_viewed', {});
    // The threshold flush is async; let the microtask settle.
    await Promise.resolve();
    await Promise.resolve();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('requeues events when a flush fails so they retry next flush', async () => {
    const fetchImpl = okFetch();
    fetchImpl.mockRejectedValueOnce(new Error('offline'));
    const sink = createPostHogSink({
      apiKey: 'phc_test',
      getDistinctId: () => 'user-1',
      flushIntervalMs: 0,
      fetchImpl,
      now,
    });

    sink.capture('paywall_viewed', {});
    await sink.flush(); // fails, requeues
    await sink.flush(); // succeeds
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const secondInit = fetchImpl.mock.calls[1][1] as RequestInit;
    const payload = JSON.parse(secondInit.body as string);
    expect(payload.batch[0].event).toBe('paywall_viewed');
  });

  it('emits an $identify alias with the anonymous id', async () => {
    const fetchImpl = okFetch();
    const sink = createPostHogSink({
      apiKey: 'phc_test',
      getDistinctId: () => 'user-9',
      flushIntervalMs: 0,
      fetchImpl,
      now,
    });

    sink.identify('user-9', 'anon_abc');
    await sink.flush();

    const payload = JSON.parse((fetchImpl.mock.calls[0][1] as RequestInit).body as string);
    expect(payload.batch[0]).toMatchObject({
      event: '$identify',
      distinct_id: 'user-9',
      properties: { $anon_distinct_id: 'anon_abc' },
    });
  });

  it('does not fetch when the queue is empty', async () => {
    const fetchImpl = okFetch();
    const sink = createPostHogSink({
      apiKey: 'phc_test',
      getDistinctId: () => 'user-1',
      flushIntervalMs: 0,
      fetchImpl,
      now,
    });
    await sink.flush();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
