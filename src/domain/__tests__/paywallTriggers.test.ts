import {
  DEFAULT_PAYWALL_TRIGGER,
  PAYWALL_TRIGGER_COPY,
  PAYWALL_TRIGGERS,
  resolvePaywallTrigger,
} from '../paywallTriggers';

describe('paywall triggers (Pass 0)', () => {
  it('keeps the three existing triggers and adds the Road Wallet / packet ones', () => {
    expect(PAYWALL_TRIGGERS).toEqual([
      'rate_check_limit',
      'compare',
      'lane_history',
      'cloud_document_backup',
      'saved_presentation_sets',
      'document_share_export',
      'carrier_packet',
    ]);
  });

  it('has headline + body copy for every trigger', () => {
    for (const t of PAYWALL_TRIGGERS) {
      expect(PAYWALL_TRIGGER_COPY[t].headline.length).toBeGreaterThan(0);
      expect(PAYWALL_TRIGGER_COPY[t].body.length).toBeGreaterThan(0);
    }
  });

  it('resolves known params and falls back to the rate-check copy otherwise', () => {
    expect(resolvePaywallTrigger('carrier_packet')).toBe('carrier_packet');
    expect(resolvePaywallTrigger('cloud_document_backup')).toBe('cloud_document_backup');
    expect(resolvePaywallTrigger('not_a_trigger')).toBe(DEFAULT_PAYWALL_TRIGGER);
    expect(resolvePaywallTrigger(undefined)).toBe('rate_check_limit');
  });

  it('never claims legal acceptance, submission or signing for the user', () => {
    const all = Object.values(PAYWALL_TRIGGER_COPY)
      .map((c) => `${c.headline} ${c.body}`)
      .join(' ')
      .toLowerCase();
    expect(all).not.toMatch(/legally|compliant|guarantee/);
    expect(all).toContain('nothing is submitted or signed for you');
  });
});
