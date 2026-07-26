/**
 * Subscription tiers, prices, free-tier caps, and feature gates.
 *
 * Base prices come from the Master Build Prompt (Loop 13). The Freight
 * Intelligence integration (Master Additive Integration Prompt) adds the
 * `lifetime` entitlement, freight free-tier caps, and freight feature gates.
 * One subscription system — there is no separate Freight Intelligence plan
 * (Section 39). Caps marked PROPOSED are not fixed by any spec.
 */

export const TIERS = ['free', 'driver_pro', 'owner_operator', 'fleet_lite', 'lifetime'] as const;
export type Tier = (typeof TIERS)[number];

export const TIER_INFO: Record<
  Tier,
  { name: string; monthlyUsd: number; annualUsd: number; oneTimeUsd?: number }
> = {
  free: { name: 'Road Log', monthlyUsd: 0, annualUsd: 0 },
  driver_pro: { name: 'Driver Pro', monthlyUsd: 6.99, annualUsd: 49.99 },
  owner_operator: { name: 'Owner-Operator', monthlyUsd: 9.99, annualUsd: 79.99 },
  fleet_lite: { name: 'Fleet Lite — Unit Control', monthlyUsd: 19.99, annualUsd: 199 },
  // Existing approved launch offer (Section 43). One-time; do not change without
  // product-owner approval.
  lifetime: { name: 'Lifetime', monthlyUsd: 0, annualUsd: 0, oneTimeUsd: 149 },
};

/** Fleet Lite includes 2 trucks; extra trucks are add-ons (Loop 13). */
export const FLEET_LITE_INCLUDED_TRUCKS = 2;
export const FLEET_LITE_EXTRA_TRUCK_MONTHLY_USD = 4;
export const FLEET_LITE_EXTRA_TRUCK_ANNUAL_USD = 39;

export const FREE_LIMITS = {
  /** Stated in the roadmap (Phase 10): free plan includes 30 GPS trips/month. */
  gpsTripsPerMonth: 30,
  /** PROPOSED. */
  scansPerMonth: 25,
  /** PROPOSED. */
  activeLoadFolders: 5,
  /** Section 40: up to 3 Rate Checks per month on the free tier. */
  rateChecksPerMonth: 3,
  /** Section 40: up to 5 Broker Checks per month on the free tier. */
  brokerChecksPerMonth: 5,
  /** Section 40: save up to 3 watched lanes on the free tier. */
  watchedLanes: 3,
  /** Section 40: "limited Compare to My Costs usage." PROPOSED count. */
  compareToCostsPerMonth: 5,
} as const;

/**
 * Feature gates. Free-tier features (rate card creation, external sharing, board
 * viewing, eligible posting, reporting/blocking safety controls) are gated at
 * `free` so everyone has them — safety controls are never paid (Section 40).
 */
export const FEATURE_MIN_TIER = {
  // existing
  unlimitedScans: 'driver_pro',
  loadPacketExport: 'driver_pro',
  detentionLumperHistory: 'driver_pro',
  rpmCoach: 'owner_operator',
  weeklyMonthlyGrades: 'owner_operator',
  monthlyCloseout: 'owner_operator',
  monthlyReportExport: 'owner_operator',
  multiTruck: 'fleet_lite',
  // freight — free tier
  rateCardCreate: 'free',
  rateCardExternalShare: 'free',
  communityBoardView: 'free',
  eligiblePublicPosting: 'free',
  marketPulseOverview: 'free',
  // freight — Driver Pro
  rateConScan: 'driver_pro',
  brokerWatchlist: 'driver_pro',
  unlimitedBrokerChecks: 'driver_pro',
  syncedLoadHistory: 'driver_pro',
  cloudBackup: 'driver_pro',
  // freight — Owner-Operator
  unlimitedRateChecks: 'owner_operator',
  fullFreightIntelligence: 'owner_operator',
  unlimitedCompareToCosts: 'owner_operator',
  laneAlerts: 'owner_operator',
  laneHistory30Day: 'owner_operator',
  laneHistory90Day: 'owner_operator',
  communityRateVsCost: 'owner_operator',
} as const satisfies Record<string, Tier>;

/**
 * Linear order for feature gating. `lifetime` sits at the Owner-Operator level:
 * it unlocks all individual premium + Phase-One Freight Intelligence features
 * (Section 43) but not fleet multi-truck management.
 */
const TIER_ORDER: Record<Tier, number> = {
  free: 0,
  driver_pro: 1,
  owner_operator: 2,
  lifetime: 2,
  fleet_lite: 3,
};

export const tierAtLeast = (tier: Tier, min: Tier): boolean => TIER_ORDER[tier] >= TIER_ORDER[min];

export const canUseFeature = (tier: Tier, feature: keyof typeof FEATURE_MIN_TIER): boolean =>
  tierAtLeast(tier, FEATURE_MIN_TIER[feature]);

/**
 * Provider-agnostic data-entitlement layer (Section 44). Prepared now so future
 * licensed commercial lane-rate data can be gated separately from the app
 * subscription — a lifetime purchase includes only `basic_community_intelligence`
 * and is never promised unlimited licensed third-party data.
 */
export const DATA_ENTITLEMENTS = [
  'basic_community_intelligence',
  'licensed_market_intelligence',
  'high_volume_market_intelligence',
] as const;
export type DataEntitlement = (typeof DATA_ENTITLEMENTS)[number];

/** What each tier includes today. Licensed tiers are reserved for a future release. */
export const TIER_DATA_ENTITLEMENTS: Record<Tier, readonly DataEntitlement[]> = {
  free: ['basic_community_intelligence'],
  driver_pro: ['basic_community_intelligence'],
  owner_operator: ['basic_community_intelligence'],
  fleet_lite: ['basic_community_intelligence'],
  lifetime: ['basic_community_intelligence'],
};

export const hasDataEntitlement = (tier: Tier, entitlement: DataEntitlement): boolean =>
  TIER_DATA_ENTITLEMENTS[tier].includes(entitlement);
