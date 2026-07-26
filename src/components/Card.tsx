import { ReactNode } from 'react';
import { StyleSheet, Text, View, ViewStyle } from 'react-native';

import { colors, radii, spacing, type } from '@/theme';

interface CardProps {
  children: ReactNode;
  /** Small uppercase label row: left text and optional right text. */
  label?: string;
  labelRight?: string;
  /** Raised hero-card variant (a touch brighter than the base surface). */
  dark?: boolean;
  compact?: boolean;
  style?: ViewStyle;
}

/** Card — the base translucent-ivory surface of the Night Atlas system. */
export function Card({ children, label, labelRight, dark, compact, style }: CardProps) {
  return (
    <View style={[styles.card, compact && styles.compact, dark && styles.raised, style]}>
      {label !== undefined && (
        <View style={styles.labelRow}>
          <Text style={styles.label}>{label}</Text>
          {labelRight !== undefined && <Text style={styles.label}>{labelRight}</Text>}
        </View>
      )}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.card,
    borderWidth: 1,
    padding: spacing.lg,
  },
  compact: {
    borderRadius: radii.row,
    padding: spacing.md,
  },
  raised: {
    backgroundColor: colors.surfaceRaised,
  },
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.sm + 1,
  },
  label: {
    ...type.label,
    color: colors.textFaint,
  },
});
