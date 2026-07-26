import { TextStyle } from 'react-native';

/**
 * Inter (via @expo-google-fonts/inter) for everything structural; JetBrains Mono
 * (via @expo-google-fonts/jetbrains-mono) for the "map-margin" micro-labels.
 * Both are loaded in the root layout.
 */
export const fonts = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
  extrabold: 'Inter_800ExtraBold',
  black: 'Inter_900Black',
  mono: 'JetBrainsMono_500Medium',
  monoBold: 'JetBrainsMono_700Bold',
} as const;

/**
 * Night Atlas type scale (README · Typography). Big, black display numerals;
 * tabular figures on every metric; small uppercase mono labels for the operational
 * voice. Existing role names are retained (and repointed) so call sites don't churn.
 */
export const type = {
  // Display / headings
  hero: {
    fontFamily: fonts.black,
    fontSize: 78,
    lineHeight: 70,
    letterSpacing: -4.4,
    fontVariant: ['tabular-nums'],
  } satisfies TextStyle,
  h1: {
    // Screen title
    fontFamily: fonts.black,
    fontSize: 32,
    lineHeight: 34,
    letterSpacing: -1.5,
  } satisfies TextStyle,
  section: {
    fontFamily: fonts.black,
    fontSize: 26,
    lineHeight: 28,
    letterSpacing: -1.2,
  } satisfies TextStyle,
  h2: {
    // Card / section title
    fontFamily: fonts.extrabold,
    fontSize: 17,
    lineHeight: 21,
    letterSpacing: -0.4,
  } satisfies TextStyle,
  cardTitle: {
    fontFamily: fonts.extrabold,
    fontSize: 16,
    lineHeight: 20,
    letterSpacing: -0.4,
  } satisfies TextStyle,
  rowTitle: {
    fontFamily: fonts.bold,
    fontSize: 15,
    lineHeight: 19,
    letterSpacing: -0.2,
  } satisfies TextStyle,

  // Metrics
  metricLg: {
    fontFamily: fonts.black,
    fontSize: 46,
    lineHeight: 46,
    letterSpacing: -2.4,
    fontVariant: ['tabular-nums'],
  } satisfies TextStyle,
  metric: {
    fontFamily: fonts.black,
    fontSize: 32,
    lineHeight: 34,
    letterSpacing: -1.4,
    fontVariant: ['tabular-nums'],
  } satisfies TextStyle,
  metricSm: {
    fontFamily: fonts.extrabold,
    fontSize: 18,
    lineHeight: 20,
    letterSpacing: -0.6,
    fontVariant: ['tabular-nums'],
  } satisfies TextStyle,

  // Body
  body: {
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 21,
  } satisfies TextStyle,
  bodySmall: {
    fontFamily: fonts.regular,
    fontSize: 12,
    lineHeight: 16,
  } satisfies TextStyle,
  emphasis: {
    fontFamily: fonts.bold,
    fontSize: 14,
    lineHeight: 18,
    letterSpacing: -0.2,
  } satisfies TextStyle,
  rowCaption: {
    fontFamily: fonts.regular,
    fontSize: 11.5,
    lineHeight: 16,
  } satisfies TextStyle,
  button: {
    fontFamily: fonts.extrabold,
    fontSize: 16,
    letterSpacing: -0.2,
  } satisfies TextStyle,

  // Map-margin voice — JetBrains Mono, uppercase. `label`/`labelTiny` keep their
  // names (widely used) but are now mono, matching the design's operational labels.
  label: {
    fontFamily: fonts.monoBold,
    fontSize: 10,
    lineHeight: 13,
    letterSpacing: 1.6,
    textTransform: 'uppercase',
  } satisfies TextStyle,
  labelTiny: {
    fontFamily: fonts.monoBold,
    fontSize: 9,
    lineHeight: 12,
    letterSpacing: 1.0,
    textTransform: 'uppercase',
  } satisfies TextStyle,
  mapLabel: {
    fontFamily: fonts.monoBold,
    fontSize: 10,
    lineHeight: 13,
    letterSpacing: 1.8,
    textTransform: 'uppercase',
  } satisfies TextStyle,
  dataLabel: {
    fontFamily: fonts.mono,
    fontSize: 9,
    lineHeight: 12,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  } satisfies TextStyle,
} as const;
