/** Spacing and radii lifted from the Industrial Atlas mockup (28/18/12 radius scale). */
export const radii = {
  lg: 28,
  md: 18,
  sm: 12,
  pill: 999,
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 28,
} as const;

/** Minimum tap target per accessibility requirements (Master Build Prompt §7). */
export const minTapTarget = 48;
