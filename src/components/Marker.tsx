import { StyleSheet, Text, View, ViewStyle } from 'react-native';

import { fonts, markerFills, radii, Tone } from '@/theme';
// Waypoint square: size 32-34, radius 11-12 (Night Atlas geometry).

interface MarkerProps {
  /** One or two characters: a number, letter grade, ✓, !, $ … */
  label: string;
  tone?: Tone;
  size?: number;
  style?: ViewStyle;
}

/** Waypoint-style square marker used in route bands and lists. */
export function Marker({ label, tone = 'neutral', size = 32, style }: MarkerProps) {
  const fill = markerFills[tone];
  return (
    <View
      style={[
        styles.box,
        { width: size, height: size, borderRadius: radii.marker, backgroundColor: fill.bg },
        style,
      ]}
    >
      <Text style={[styles.label, { color: fill.fg }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontFamily: fonts.black,
    fontSize: 13,
    letterSpacing: -0.5,
  },
});
