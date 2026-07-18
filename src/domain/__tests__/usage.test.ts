import { checkAllowance, currentMonthKey } from '../usage';

describe('currentMonthKey', () => {
  it('formats YYYY-MM', () => {
    expect(currentMonthKey(new Date('2026-07-18T12:00:00Z'))).toMatch(/^2026-0?7$|^2026-07$/);
    expect(currentMonthKey(new Date('2026-01-02T12:00:00Z'))).toContain('2026-01');
  });
});

describe('checkAllowance', () => {
  it('caps free rate checks at 3/month (Section 40)', () => {
    expect(checkAllowance('free', 'rate_check', 0)).toEqual({ allowed: true, remaining: 3 });
    expect(checkAllowance('free', 'rate_check', 2)).toEqual({ allowed: true, remaining: 1 });
    expect(checkAllowance('free', 'rate_check', 3)).toEqual({ allowed: false, remaining: 0 });
  });

  it('caps free broker checks at 5/month', () => {
    expect(checkAllowance('free', 'broker_check', 5).allowed).toBe(false);
    expect(checkAllowance('driver_pro', 'broker_check', 999)).toEqual({
      allowed: true,
      remaining: null,
    });
  });

  it('unlimits owner-operator and lifetime everywhere', () => {
    for (const tier of ['owner_operator', 'lifetime'] as const) {
      expect(checkAllowance(tier, 'rate_check', 999).allowed).toBe(true);
      expect(checkAllowance(tier, 'compare_to_costs', 999).allowed).toBe(true);
    }
  });

  it('driver_pro still meters rate checks (unlimited is Owner-Operator)', () => {
    expect(checkAllowance('driver_pro', 'rate_check', 3).allowed).toBe(false);
  });
});
