import { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, ViewStyle } from 'react-native';

import { colors, fonts, radii, spacing, Tone, type } from '@/theme';

import { Marker } from './Marker';

interface RouteBandProps {
  /** Marker glyph: number, grade, ✓, !, $ … */
  marker: string;
  markerTone?: Tone;
  title: string;
  subtitle?: string;
  /** Right-aligned value or short action word. */
  value?: string | ReactNode;
  onPress?: () => void;
  /** Retained for API compatibility (bands are dark now). */
  dark?: boolean;
  style?: ViewStyle;
}

/**
 * Route Band — the signature status/progress row: a waypoint marker on a dashed
 * route line, copy in the middle, value on the right. The route line is Fuel
 * Amber on the dark canvas.
 */
export function RouteBand({
  marker,
  markerTone = 'neutral',
  title,
  subtitle,
  value,
  onPress,
  style,
}: RouteBandProps) {
  const content = (
    <View style={[styles.band, style]}>
      <View style={styles.routeLine} aria-hidden />
      <Marker label={marker} tone={markerTone} />
      <View style={styles.copy}>
        <Text style={styles.title}>{title}</Text>
        {subtitle !== undefined && <Text style={styles.subtitle}>{subtitle}</Text>}
      </View>
      {typeof value === 'string' ? <Text style={styles.value}>{value}</Text> : value}
    </View>
  );

  if (onPress) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={subtitle ? `${title}. ${subtitle}` : title}
        onPress={onPress}
        style={({ pressed }) => pressed && styles.pressed}
      >
        {content}
      </Pressable>
    );
  }
  return content;
}

const styles = StyleSheet.create({
  band: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.row,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.sm + 2,
    overflow: 'hidden',
    padding: spacing.md + 1,
  },
  routeLine: {
    borderColor: 'rgba(217, 133, 43, 0.35)',
    borderLeftWidth: 1,
    borderStyle: 'dashed',
    bottom: 0,
    left: 28,
    position: 'absolute',
    top: 0,
    width: 1,
  },
  copy: {
    flex: 1,
  },
  title: {
    ...type.rowTitle,
    color: colors.text,
    marginBottom: 2,
  },
  subtitle: {
    ...type.bodySmall,
    color: colors.textMuted,
  },
  value: {
    color: colors.text,
    fontFamily: fonts.black,
    fontSize: 15,
    fontVariant: ['tabular-nums'],
    letterSpacing: -0.5,
  },
  pressed: {
    opacity: 0.7,
  },
});
