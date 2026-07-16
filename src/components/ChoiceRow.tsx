import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radii, spacing, Tone, type } from '@/theme';

import { Marker } from './Marker';

interface ChoiceRowProps {
  marker: string;
  markerTone?: Tone;
  title: string;
  subtitle?: string;
  selected?: boolean;
  onPress: () => void;
}

/** Selectable option row used across onboarding (role, first job). */
export function ChoiceRow({
  marker,
  markerTone = 'neutral',
  title,
  subtitle,
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
        <Text style={styles.title}>{title}</Text>
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
  title: {
    ...type.emphasis,
    color: colors.text,
    marginBottom: 3,
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
