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
  dark?: boolean;
  style?: ViewStyle;
}

/**
 * Route Band — the signature Industrial Atlas status/progress row
 * (Master Build Prompt §2). A waypoint marker on a dashed route line,
 * copy in the middle, value on the right.
 */
export function RouteBand({
  marker,
  markerTone = 'neutral',
  title,
  subtitle,
  value,
  onPress,
  dark,
  style,
}: RouteBandProps) {
  const content = (
    <View style={[styles.band, dark && styles.bandDark, style]}>
      <View style={styles.routeLine} aria-hidden />
      <Marker label={marker} tone={markerTone} />
      <View style={styles.copy}>
        <Text style={[styles.title, dark && styles.titleOnDark]}>{title}</Text>
        {subtitle !== undefined && (
          <Text style={[styles.subtitle, dark && styles.subtitleOnDark]}>{subtitle}</Text>
        )}
      </View>
      {typeof value === 'string' ? (
        <Text style={[styles.value, dark && styles.titleOnDark]}>{value}</Text>
      ) : (
        value
      )}
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
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.md - 2,
    marginTop: spacing.sm + 2,
    overflow: 'hidden',
    padding: spacing.md,
  },
  bandDark: {
    backgroundColor: 'rgba(244, 241, 232, 0.07)',
    borderColor: colors.borderOnDark,
  },
  routeLine: {
    borderColor: 'rgba(61, 100, 128, 0.36)',
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
    ...type.emphasis,
    color: colors.text,
    marginBottom: 2,
  },
  titleOnDark: {
    color: colors.textOnDark,
  },
  subtitle: {
    ...type.bodySmall,
    color: colors.textMuted,
  },
  subtitleOnDark: {
    color: 'rgba(244, 241, 232, 0.58)',
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
