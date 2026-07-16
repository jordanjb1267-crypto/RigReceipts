import { StyleSheet, Text, View, ViewStyle } from 'react-native';

import { colors, radii, spacing, type } from '@/theme';

interface MetricTileProps {
  label: string;
  value: string;
  caption?: string;
  dark?: boolean;
  style?: ViewStyle;
}

/** Small label + tabular-figure metric, used in rows of two or three. */
export function MetricTile({ label, value, caption, dark, style }: MetricTileProps) {
  return (
    <View style={[styles.tile, dark && styles.dark, style]}>
      <Text style={[styles.label, dark && styles.labelOnDark]}>{label}</Text>
      <Text style={[styles.value, dark && styles.valueOnDark]}>{value}</Text>
      {caption !== undefined && (
        <Text style={[styles.caption, dark && styles.labelOnDark]}>{caption}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    backgroundColor: 'rgba(30, 35, 39, 0.04)',
    borderColor: 'rgba(30, 35, 39, 0.08)',
    borderRadius: radii.sm + 3,
    borderWidth: 1,
    flex: 1,
    padding: spacing.md - 1,
  },
  dark: {
    backgroundColor: 'rgba(244, 241, 232, 0.08)',
    borderColor: 'rgba(244, 241, 232, 0.10)',
  },
  label: {
    ...type.labelTiny,
    color: colors.textMuted,
    marginBottom: 5,
  },
  labelOnDark: {
    color: 'rgba(244, 241, 232, 0.55)',
  },
  value: {
    ...type.metricSm,
    color: colors.text,
  },
  valueOnDark: {
    color: colors.textOnDark,
  },
  caption: {
    ...type.bodySmall,
    color: colors.textMuted,
    marginTop: 4,
  },
});
