import { TextStyle } from 'react-native';

/** Inter is loaded in the root layout via @expo-google-fonts/inter. */
export const fonts = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
  extrabold: 'Inter_800ExtraBold',
  black: 'Inter_900Black',
} as const;

/**
 * Industrial Atlas type scale: structured headings, tabular metric numerals,
 * small uppercase operational labels (Master Build Prompt §2, Typography).
 */
export const type = {
  h1: {
    fontFamily: fonts.black,
    fontSize: 27,
    lineHeight: 29,
    letterSpacing: -1.0,
  } satisfies TextStyle,
  h2: {
    fontFamily: fonts.extrabold,
    fontSize: 18,
    lineHeight: 21,
    letterSpacing: -0.5,
  } satisfies TextStyle,
  metricLg: {
    fontFamily: fonts.black,
    fontSize: 44,
    lineHeight: 46,
    letterSpacing: -2.0,
    fontVariant: ['tabular-nums'],
  } satisfies TextStyle,
  metric: {
    fontFamily: fonts.black,
    fontSize: 30,
    lineHeight: 32,
    letterSpacing: -1.2,
    fontVariant: ['tabular-nums'],
  } satisfies TextStyle,
  metricSm: {
    fontFamily: fonts.extrabold,
    fontSize: 18,
    lineHeight: 20,
    letterSpacing: -0.6,
    fontVariant: ['tabular-nums'],
  } satisfies TextStyle,
  body: {
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 19,
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
  /** Small uppercase operational label — the "map margin" voice. */
  label: {
    fontFamily: fonts.extrabold,
    fontSize: 10,
    lineHeight: 13,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  } satisfies TextStyle,
  labelTiny: {
    fontFamily: fonts.extrabold,
    fontSize: 9,
    lineHeight: 12,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  } satisfies TextStyle,
} as const;
