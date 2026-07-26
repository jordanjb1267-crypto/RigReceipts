import { StyleSheet, Text, View, ViewStyle } from 'react-native';

import { colors, radii, spacing, type } from '@/theme';

interface MetricTileProps {
  label: string;
  value: string;
  caption?: string;
  /** Retained for API compatibility (all tiles are dark now). */
  dark?: boolean;
  style?: ViewStyle;
}

/** Small label + tabular-figure metric, used in rows of two or three. */
export function MetricTile({ label, value, caption, style }: MetricTileProps) {
  return (
    <View style={[styles.tile, style]}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
      {caption !== undefined && <Text style={styles.caption}>{caption}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: radii.field,
    borderWidth: 1,
    flex: 1,
    padding: spacing.md,
  },
  label: {
    ...type.labelTiny,
    color: colors.textFaint,
    marginBottom: 5,
  },
  value: {
    ...type.metricSm,
    color: colors.text,
  },
  caption: {
    ...type.bodySmall,
    color: colors.textMuted,
    marginTop: 4,
  },
});
