import { ANALYTICS_EVENTS } from '../events';
import { setAnalyticsContext, setAnalyticsSink, track } from '../index';

describe('analytics event catalog', () => {
  it('has unique event names', () => {
    expect(new Set(ANALYTICS_EVENTS).size).toBe(ANALYTICS_EVENTS.length);
  });

  it('includes the freight integration events (Section 47)', () => {
    for (const e of [
      'rate_check_completed',
      'rate_card_created',
      'rate_board_post_blocked',
      'community_rate_compared',
      'contributor_blocked',
    ] as const) {
      expect(ANALYTICS_EVENTS).toContain(e);
    }
  });
});

describe('track', () => {
  it('forwards known events with merged context to the sink', () => {
    const calls: { event: string; props: Record<string, unknown> }[] = [];
    setAnalyticsSink((event, props) => calls.push({ event, props }));
    setAnalyticsContext({ role: 'owner_operator', subscriptionTier: 'free' });

    track('rate_check_completed', { equipmentType: 'dry_van' });

    expect(calls).toHaveLength(1);
    expect(calls[0].event).toBe('rate_check_completed');
    expect(calls[0].props).toMatchObject({
      role: 'owner_operator',
      subscriptionTier: 'free',
      equipmentType: 'dry_van',
    });
  });

  it('drops unknown events without throwing', () => {
    const calls: string[] = [];
    setAnalyticsSink((event) => calls.push(event));
    // @ts-expect-error — intentionally invalid event name
    expect(() => track('not_a_real_event')).not.toThrow();
    expect(calls).toHaveLength(0);
  });
});
