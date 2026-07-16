/**
 * Industrial Atlas palette.
 * Source of truth: RigReceipts V2 Master Build Prompt §2 (color system table),
 * extended with values lifted from the Industrial Atlas HTML mockup (reference).
 */
export const palette = {
  // Master build prompt tokens
  mapIvory: '#F4F1E8',
  asphaltCharcoal: '#1E2327',
  deepSlate: '#374148',
  routeGreen: '#2E6B57',
  highwayBlue: '#3D6480',
  fuelAmber: '#C8912D',
  clayRust: '#9A5C3A',
  linework: '#C9C5BC',

  // Mockup extras
  asphalt2: '#15191C',
  slate2: '#53616A',
  paper: '#FBF8EF',
  paper2: '#E8E3D6',
  routeGreen2: '#3D8069',
  alertRed: '#A94A3B',
  ink: '#1F2427',
  muted: '#71716B',
  white: '#FFFFFF',
} as const;

/** Semantic roles so screens never reach for raw hex. */
export const colors = {
  background: palette.mapIvory,
  surface: palette.paper,
  surfaceDark: palette.asphaltCharcoal,
  text: palette.ink,
  textMuted: palette.muted,
  textOnDark: palette.mapIvory,
  cta: palette.routeGreen,
  good: palette.routeGreen,
  info: palette.highwayBlue,
  warning: palette.fuelAmber,
  urgent: palette.clayRust,
  danger: palette.alertRed,
  border: 'rgba(30, 35, 39, 0.10)',
  borderOnDark: 'rgba(244, 241, 232, 0.13)',
  hairline: palette.linework,
} as const;

export type Tone = 'green' | 'blue' | 'amber' | 'rust' | 'neutral';

export const toneColors: Record<Tone, { fg: string; bg: string; border: string }> = {
  green: {
    fg: palette.routeGreen,
    bg: 'rgba(46, 107, 87, 0.13)',
    border: 'rgba(46, 107, 87, 0.22)',
  },
  blue: {
    fg: palette.highwayBlue,
    bg: 'rgba(61, 100, 128, 0.15)',
    border: 'rgba(61, 100, 128, 0.22)',
  },
  amber: { fg: '#916416', bg: 'rgba(200, 145, 45, 0.15)', border: 'rgba(200, 145, 45, 0.22)' },
  rust: { fg: palette.clayRust, bg: 'rgba(154, 92, 58, 0.14)', border: 'rgba(154, 92, 58, 0.20)' },
  neutral: {
    fg: palette.deepSlate,
    bg: 'rgba(30, 35, 39, 0.06)',
    border: 'rgba(30, 35, 39, 0.10)',
  },
};

/** Marker chip fills (solid) per tone, mirroring the mockup's waypoint markers. */
export const markerFills: Record<Tone, { bg: string; fg: string }> = {
  green: { bg: palette.routeGreen, fg: palette.mapIvory },
  blue: { bg: palette.highwayBlue, fg: palette.mapIvory },
  amber: { bg: palette.fuelAmber, fg: palette.asphaltCharcoal },
  rust: { bg: palette.clayRust, fg: palette.mapIvory },
  neutral: { bg: palette.asphaltCharcoal, fg: palette.mapIvory },
};
