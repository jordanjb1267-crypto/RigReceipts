/**
 * Feature flags for the additive Freight Intelligence integration.
 *
 * Every new capability ships behind a flag (Section 50). Defaults are
 * conservative — new work is OFF in production until explicitly enabled. A flag
 * can be forced per environment with `EXPO_PUBLIC_FF_<NAME>=off|internal|beta|production`
 * or given a percentage rollout.
 */

export const FEATURE_FLAGS = [
  'freight_intelligence_enabled',
  'rate_sharing_cards_enabled',
  'community_rate_board_enabled',
  'community_rate_posting_enabled',
  'lane_aggregates_enabled',
  'broker_check_enabled',
  'revised_onboarding_enabled',
] as const;

export type FeatureFlag = (typeof FEATURE_FLAGS)[number];

export type FlagState = 'off' | 'internal' | 'beta' | 'production';

export interface FlagConfig {
  state: FlagState;
  /** 0–100. Only consulted when state is 'beta'. */
  rolloutPct?: number;
}

/** Audience the current session belongs to, used to resolve non-production states. */
export interface FlagContext {
  isInternal?: boolean;
  isBeta?: boolean;
  /** Stable id (user/device) for deterministic percentage bucketing. */
  stableId?: string;
}

/**
 * Default config. Community posting stays a controlled beta before full public
 * rollout (Section 50); read-only board + cards can go wider first.
 */
export const DEFAULT_FLAGS: Record<FeatureFlag, FlagConfig> = {
  freight_intelligence_enabled: { state: 'off' },
  rate_sharing_cards_enabled: { state: 'off' },
  community_rate_board_enabled: { state: 'off' },
  community_rate_posting_enabled: { state: 'off' },
  lane_aggregates_enabled: { state: 'off' },
  broker_check_enabled: { state: 'off' },
  revised_onboarding_enabled: { state: 'off' },
};

// Static env access (Expo inlines EXPO_PUBLIC_* at build time; dynamic keys are
// not inlined, so each override is referenced explicitly).
const ENV_OVERRIDES: Record<FeatureFlag, string | undefined> = {
  freight_intelligence_enabled: process.env.EXPO_PUBLIC_FF_FREIGHT_INTELLIGENCE_ENABLED,
  rate_sharing_cards_enabled: process.env.EXPO_PUBLIC_FF_RATE_SHARING_CARDS_ENABLED,
  community_rate_board_enabled: process.env.EXPO_PUBLIC_FF_COMMUNITY_RATE_BOARD_ENABLED,
  community_rate_posting_enabled: process.env.EXPO_PUBLIC_FF_COMMUNITY_RATE_POSTING_ENABLED,
  lane_aggregates_enabled: process.env.EXPO_PUBLIC_FF_LANE_AGGREGATES_ENABLED,
  broker_check_enabled: process.env.EXPO_PUBLIC_FF_BROKER_CHECK_ENABLED,
  revised_onboarding_enabled: process.env.EXPO_PUBLIC_FF_REVISED_ONBOARDING_ENABLED,
};

function envOverride(flag: FeatureFlag): FlagState | null {
  const raw = ENV_OVERRIDES[flag];
  if (raw && (['off', 'internal', 'beta', 'production'] as const).includes(raw as FlagState)) {
    return raw as FlagState;
  }
  return null;
}

/** Deterministic 0–99 bucket for a flag + id (FNV-1a). Same inputs → same bucket. */
export function bucketFor(flag: FeatureFlag, stableId: string): number {
  let h = 0x811c9dc5;
  const s = `${flag}:${stableId}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) % 100;
}

export function resolveFlag(
  flag: FeatureFlag,
  ctx: FlagContext = {},
  config: Record<FeatureFlag, FlagConfig> = DEFAULT_FLAGS,
): boolean {
  const state = envOverride(flag) ?? config[flag].state;
  switch (state) {
    case 'off':
      return false;
    case 'production':
      return true;
    case 'internal':
      return ctx.isInternal === true;
    case 'beta': {
      if (ctx.isInternal || ctx.isBeta) return true;
      const pct = config[flag].rolloutPct ?? 0;
      if (pct <= 0 || !ctx.stableId) return false;
      return bucketFor(flag, ctx.stableId) < pct;
    }
    default:
      return false;
  }
}

/** Convenience wrapper against the default config. */
export function isFeatureEnabled(flag: FeatureFlag, ctx: FlagContext = {}): boolean {
  return resolveFlag(flag, ctx);
}
