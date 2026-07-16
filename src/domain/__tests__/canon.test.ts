/**
 * Canon tests: lock the lists agreed in docs/DECISIONS.md against drift.
 * If one of these fails, either the decision changed (update DECISIONS.md and
 * the Supabase seed together) or the change is accidental.
 */
import { EXPENSE_CATEGORIES } from '../categories';
import { CLAIM_STATUSES } from '../claimStatus';
import { canUseFeature, FREE_LIMITS, TIER_INFO, TIERS } from '../entitlements';
import { SCAN_TYPES } from '../scanTypes';

describe('expense categories (decision 1)', () => {
  it('has exactly the Master Build Prompt 23', () => {
    expect(EXPENSE_CATEGORIES).toHaveLength(23);
  });

  it('has unique slugs', () => {
    const slugs = EXPENSE_CATEGORIES.map((c) => c.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('keeps the categories the other spec docs dropped', () => {
    const slugs = EXPENSE_CATEGORIES.map((c) => c.slug);
    expect(slugs).toEqual(
      expect.arrayContaining(['trailer_washout', 'truck_supplies', 'trailer_expenses', 'lumper']),
    );
  });
});

describe('scan types (decision 3)', () => {
  it('has exactly 15 types', () => {
    expect(SCAN_TYPES).toHaveLength(15);
  });

  it('includes hotel/lodging', () => {
    expect(SCAN_TYPES.map((t) => t.slug)).toContain('hotel');
  });
});

describe('claim statuses (decision 2)', () => {
  it('is the canonical five, in workflow order', () => {
    expect(CLAIM_STATUSES).toEqual(['pending', 'submitted', 'approved', 'reimbursed', 'denied']);
  });
});

describe('entitlements (decision 5 + Loop 13)', () => {
  it('keeps the spec-stated free GPS trip cap', () => {
    expect(FREE_LIMITS.gpsTripsPerMonth).toBe(30);
  });

  it('keeps Loop 13 pricing', () => {
    expect(TIER_INFO.driver_pro.monthlyUsd).toBe(6.99);
    expect(TIER_INFO.driver_pro.annualUsd).toBe(49.99);
    expect(TIER_INFO.owner_operator.monthlyUsd).toBe(9.99);
    expect(TIER_INFO.owner_operator.annualUsd).toBe(79.99);
    expect(TIER_INFO.fleet_lite.monthlyUsd).toBe(19.99);
  });

  it('gates RPM Coach to Owner-Operator and above', () => {
    expect(canUseFeature('free', 'rpmCoach')).toBe(false);
    expect(canUseFeature('driver_pro', 'rpmCoach')).toBe(false);
    expect(canUseFeature('owner_operator', 'rpmCoach')).toBe(true);
    expect(canUseFeature('fleet_lite', 'rpmCoach')).toBe(true);
  });

  it('gates unlimited capture to Driver Pro and above', () => {
    expect(canUseFeature('free', 'unlimitedScans')).toBe(false);
    expect(canUseFeature('driver_pro', 'unlimitedScans')).toBe(true);
  });

  it('has the five tiers incl. lifetime', () => {
    expect(TIERS).toEqual(['free', 'driver_pro', 'owner_operator', 'fleet_lite', 'lifetime']);
  });
});
