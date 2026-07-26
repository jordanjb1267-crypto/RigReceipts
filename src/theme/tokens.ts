import { Platform } from 'react-native';

/**
 * Night Atlas geometry (README · Geometry). Cards 20–24, rows 16–19, fields 16,
 * grade badge / marker squares, pill CTA. Legacy `lg`/`md`/`sm` names are kept
 * (and repointed) so existing call sites compile.
 */
export const radii = {
  card: 22,
  row: 18,
  field: 16,
  badge: 16,
  marker: 12,
  pill: 999,
  /** Android CTAs use a rounded rect, not a pill. */
  cta: Platform.OS === 'android' ? 16 : 999,

  // Back-compat aliases
  lg: 22,
  md: 18,
  sm: 12,
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 28,
} as const;

/** Fixed pixel sizes referenced by name. */
export const sizes = {
  progressBar: 3,
  /** Primary button height; Live Mileage overrides to 60 (operated in motion). */
  button: 56,
  liveButton: 60,
} as const;

/** Minimum tap target per accessibility requirements. */
export const minTapTarget = 48;
