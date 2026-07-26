/**
 * Night Atlas palette — the dark, cab-friendly redesign
 * (design_handoff_rigreceipts_night_atlas/README.md · Design tokens).
 *
 * The Industrial Atlas source hexes stay in `palette` because the brand mark,
 * markers, and tone fills still reference them. The semantic `colors` roles are
 * now dark, and Fuel Amber is promoted from a status tone to the primary action.
 */
export const palette = {
  // Industrial Atlas source hexes (still referenced by the mark, markers, tones)
  mapIvory: '#F4F1E8',
  asphaltCharcoal: '#1E2327',
  deepSlate: '#374148',
  routeGreen: '#2E6B57',
  highwayBlue: '#3D6480',
  fuelAmber: '#C8912D',
  clayRust: '#9A5C3A',
  linework: '#C9C5BC',
  asphalt2: '#15191C',
  slate2: '#53616A',
  paper: '#FBF8EF',
  paper2: '#E8E3D6',
  routeGreen2: '#3D8069',
  alertRed: '#A94A3B',
  ink: '#1F2427',
  muted: '#71716B',
  white: '#FFFFFF',

  // Night Atlas additions
  canvas: '#12171A',
  canvasDeep: '#0D1113',
  action: '#D9852B', // Fuel Amber, promoted to primary action
  goodLight: '#5FA98C', // above-target / verified text on dark
} as const;

/** Map Ivory at an alpha — the translucent-ivory layering the dark theme is built on. */
export const ivory = (a: number) => `rgba(244, 241, 232, ${a})`;

/** Semantic roles — dark ("Night Atlas"). Screens never reach for raw hex. */
export const colors = {
  // Surfaces
  background: palette.canvas,
  canvasDeep: palette.canvasDeep,
  surface: ivory(0.05),
  surfaceRaised: ivory(0.06),
  border: ivory(0.1),
  borderSoft: ivory(0.07),

  // Action (Fuel Amber)
  cta: palette.action,
  action: palette.action,
  actionInk: palette.canvas,

  // Text
  text: palette.mapIvory,
  textMuted: ivory(0.55),
  textFaint: ivory(0.45),
  textGhost: ivory(0.42),

  // Status
  good: palette.goodLight, // positive values / verified text
  goodDeep: palette.routeGreen, // verdict pill, checkbox fill, marker squares
  info: palette.highwayBlue,
  warning: palette.fuelAmber,
  urgent: palette.clayRust,
  danger: palette.alertRed,

  // Back-compat aliases (existing call sites referenced these on light theme;
  // they now resolve to the dark equivalents so nothing breaks).
  surfaceDark: palette.canvas,
  textOnDark: palette.mapIvory,
  borderOnDark: ivory(0.1),
  hairline: ivory(0.1),
} as const;

export type Tone = 'green' | 'blue' | 'amber' | 'rust' | 'neutral';

/** Tone fills for dark: rgba(<tone>,.22) bg, rgba(<tone>,.4) border, readable fg. */
export const toneColors: Record<Tone, { fg: string; bg: string; border: string }> = {
  green: { fg: palette.goodLight, bg: 'rgba(46, 107, 87, 0.22)', border: 'rgba(46, 107, 87, 0.4)' },
  blue: { fg: '#7BA6C4', bg: 'rgba(61, 100, 128, 0.22)', border: 'rgba(61, 100, 128, 0.4)' },
  amber: { fg: '#D9A44C', bg: 'rgba(200, 145, 45, 0.22)', border: 'rgba(200, 145, 45, 0.4)' },
  rust: { fg: '#C99A7E', bg: 'rgba(154, 92, 58, 0.22)', border: 'rgba(154, 92, 58, 0.4)' },
  neutral: { fg: ivory(0.55), bg: ivory(0.06), border: ivory(0.1) },
};

/** Solid marker/waypoint square fills per tone (dark theme). */
export const markerFills: Record<Tone, { bg: string; fg: string }> = {
  green: { bg: palette.routeGreen, fg: palette.mapIvory },
  blue: { bg: palette.highwayBlue, fg: palette.mapIvory },
  amber: { bg: palette.action, fg: palette.canvas },
  rust: { bg: palette.clayRust, fg: palette.mapIvory },
  neutral: { bg: ivory(0.12), fg: palette.mapIvory },
};
