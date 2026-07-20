/**
 * Canonical analytics event names (Section 47). Kept as a typed union so call
 * sites can't drift. No analytics SDK is wired yet (PostHog is a later phase);
 * `track` below is a no-op logger that centralizes events until then.
 */
export const ANALYTICS_EVENTS = [
  // onboarding
  'onboarding_started',
  'role_selected',
  'first_job_selected',
  'road_board_revealed',
  'first_load_saved',
  'account_created',
  // rate check
  'rate_check_started',
  'rate_check_completed',
  'first_profit_verdict_viewed',
  // rate con scan
  'rate_con_scan_started',
  'rate_con_scan_completed',
  // rate cards
  'rate_card_created',
  'rate_card_previewed',
  'rate_card_external_share_started',
  'rate_card_external_share_completed',
  // community rate board
  'rate_board_post_started',
  'rate_board_post_completed',
  'rate_board_post_blocked',
  'community_board_viewed',
  'community_rate_opened',
  'community_rate_compared',
  'lane_saved',
  'lane_alert_enabled',
  'rate_board_post_reported',
  'contributor_blocked',
  // live mileage
  'mileage_session_started',
  'mileage_loaded_confirmed',
  'mileage_delivered_confirmed',
  'mileage_segment_reclassified',
  'mileage_session_stopped',
  // monetization
  'paywall_viewed',
  'subscription_started',
  'subscription_plan_selected',
] as const;

export type AnalyticsEvent = (typeof ANALYTICS_EVENTS)[number];
