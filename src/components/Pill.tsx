import { StyleSheet, Text, View, ViewStyle } from 'react-native';

import { fonts, radii, Tone, toneColors } from '@/theme';

interface PillProps {
  label: string;
  tone?: Tone;
  style?: ViewStyle;
}

/** Status pill — good/attention/info/urgent chips across the app. */
export function Pill({ label, tone = 'green', style }: PillProps) {
  const c = toneColors[tone];
  return (
    <View style={[styles.pill, { backgroundColor: c.bg, borderColor: c.border }, style]}>
      <Text style={[styles.label, { color: c.fg }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    alignSelf: 'flex-start',
    borderRadius: radii.pill,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  label: {
    fontFamily: fonts.extrabold,
    fontSize: 10,
    letterSpacing: 0.2,
  },
});
