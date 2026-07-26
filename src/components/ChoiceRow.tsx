import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radii, spacing, Tone, type } from '@/theme';

interface ChoiceRowProps {
  /** Retained for API compatibility; the radio control replaces the marker. */
  marker?: string;
  markerTone?: Tone;
  title: string;
  subtitle?: string;
  /** Optional highlight chip, e.g. "Best place to start". */
  badge?: string;
  selected?: boolean;
  onPress: () => void;
}

/** Selectable radio row used across onboarding (role, first job). */
export function ChoiceRow({ title, subtitle, badge, selected = false, onPress }: ChoiceRowProps) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [styles.row, selected && styles.selected, pressed && styles.pressed]}
    >
      <View style={[styles.ring, selected && styles.ringOn]}>
        {selected && <View style={styles.dot} />}
      </View>
      <View style={styles.copy}>
        <View style={styles.titleRow}>
          <Text style={styles.title}>{title}</Text>
          {badge !== undefined && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{badge}</Text>
            </View>
          )}
        </View>
        {subtitle !== undefined && <Text style={styles.subtitle}>{subtitle}</Text>}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.row,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.md + 2,
  },
  selected: {
    backgroundColor: 'rgba(217, 133, 43, 0.14)',
    borderColor: colors.action,
  },
  pressed: {
    opacity: 0.8,
  },
  ring: {
    alignItems: 'center',
    borderColor: colors.textGhost,
    borderRadius: 10,
    borderWidth: 2,
    height: 20,
    justifyContent: 'center',
    width: 20,
  },
  ringOn: {
    borderColor: colors.action,
  },
  dot: {
    backgroundColor: colors.action,
    borderRadius: 4.5,
    height: 9,
    width: 9,
  },
  copy: {
    flex: 1,
  },
  titleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: 3,
  },
  badge: {
    backgroundColor: 'rgba(217, 133, 43, 0.2)',
    borderRadius: radii.pill,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  badgeText: {
    ...type.labelTiny,
    color: colors.action,
  },
  title: {
    ...type.rowTitle,
    color: colors.text,
  },
  subtitle: {
    ...type.bodySmall,
    color: colors.textMuted,
  },
});
