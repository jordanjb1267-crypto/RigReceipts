/**
 * Subscription tiers, prices, and free-tier caps.
 * Prices come from the Master Build Prompt (Loop 13). Caps marked PROPOSED are
 * not stated in any spec document — see docs/DECISIONS.md (decision 5) — and
 * can be tuned without schema changes.
 */
export const TIERS = ['free', 'driver_pro', 'owner_operator', 'fleet_lite'] as const;
export type Tier = (typeof TIERS)[number];

export const TIER_INFO: Record<Tier, { name: string; monthlyUsd: number; annualUsd: number }> = {
  free: { name: 'Free — Road Log', monthlyUsd: 0, annualUsd: 0 },
  driver_pro: { name: 'Driver Pro — Capture Everything', monthlyUsd: 6.99, annualUsd: 49.99 },
  owner_operator: { name: 'Owner-Operator — Profit Coach', monthlyUsd: 9.99, annualUsd: 79.99 },
  fleet_lite: { name: 'Fleet Lite — Unit Control', monthlyUsd: 19.99, annualUsd: 199 },
};

/** Fleet Lite includes 2 trucks; extra trucks are add-ons (Loop 13). */
export const FLEET_LITE_INCLUDED_TRUCKS = 2;
export const FLEET_LITE_EXTRA_TRUCK_MONTHLY_USD = 4;
export const FLEET_LITE_EXTRA_TRUCK_ANNUAL_USD = 39;

export const FREE_LIMITS = {
  /** Stated in the roadmap (Phase 10): free plan includes 30 GPS trips/month. */
  gpsTripsPerMonth: 30,
  /** PROPOSED — no number stated in any spec document. */
  scansPerMonth: 25,
  /** PROPOSED — no number stated in any spec document. */
  activeLoadFolders: 5,
} as const;

/** Feature gates mapped from the Master Build Prompt's upgrade moments. */
export const FEATURE_MIN_TIER = {
  unlimitedScans: 'driver_pro',
  loadPacketExport: 'driver_pro',
  detentionLumperHistory: 'driver_pro',
  rpmCoach: 'owner_operator',
  weeklyMonthlyGrades: 'owner_operator',
  monthlyCloseout: 'owner_operator',
  monthlyReportExport: 'owner_operator',
  multiTruck: 'fleet_lite',
} as const satisfies Record<string, Tier>;

const TIER_ORDER: Record<Tier, number> = {
  free: 0,
  driver_pro: 1,
  owner_operator: 2,
  fleet_lite: 3,
};

export const tierAtLeast = (tier: Tier, min: Tier): boolean => TIER_ORDER[tier] >= TIER_ORDER[min];

export const canUseFeature = (tier: Tier, feature: keyof typeof FEATURE_MIN_TIER): boolean =>
  tierAtLeast(tier, FEATURE_MIN_TIER[feature]);
