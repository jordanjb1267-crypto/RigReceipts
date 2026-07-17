import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radii, spacing, Tone, type } from '@/theme';

import { Marker } from './Marker';

interface ChoiceRowProps {
  marker: string;
  markerTone?: Tone;
  title: string;
  subtitle?: string;
  /** Optional highlight chip, e.g. "Best Place to Start". */
  badge?: string;
  selected?: boolean;
  onPress: () => void;
}

/** Selectable option row used across onboarding (role, first job). */
export function ChoiceRow({
  marker,
  markerTone = 'neutral',
  title,
  subtitle,
  badge,
  selected = false,
  onPress,
}: ChoiceRowProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [styles.row, selected && styles.selected, pressed && styles.pressed]}
    >
      <Marker label={marker} tone={markerTone} />
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
      <Text style={styles.chevron}>{selected ? '✓' : '→'}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.md + 1,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.md + 1,
  },
  selected: {
    borderColor: 'rgba(46, 107, 87, 0.42)',
  },
  pressed: {
    opacity: 0.8,
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
    backgroundColor: 'rgba(46, 107, 87, 0.13)',
    borderRadius: radii.pill,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  badgeText: {
    ...type.labelTiny,
    color: colors.cta,
  },
  title: {
    ...type.emphasis,
    color: colors.text,
  },
  subtitle: {
    ...type.bodySmall,
    color: colors.textMuted,
  },
  chevron: {
    ...type.emphasis,
    color: colors.cta,
  },
});
