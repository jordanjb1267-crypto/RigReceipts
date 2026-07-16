import { ReactNode } from 'react';
import { StyleSheet, Text, View, ViewStyle } from 'react-native';

import { colors, radii, spacing, type } from '@/theme';

interface CardProps {
  children: ReactNode;
  /** Small uppercase label row: left text and optional right text. */
  label?: string;
  labelRight?: string;
  /** Dark asphalt panel variant (hero cards). */
  dark?: boolean;
  compact?: boolean;
  style?: ViewStyle;
}

/** Paper card — the base surface of the Industrial Atlas system. */
export function Card({ children, label, labelRight, dark, compact, style }: CardProps) {
  return (
    <View style={[styles.card, compact && styles.compact, dark && styles.dark, style]}>
      {label !== undefined && (
        <View style={styles.labelRow}>
          <Text style={[styles.label, dark && styles.labelOnDark]}>{label}</Text>
          {labelRight !== undefined && (
            <Text style={[styles.label, dark && styles.labelOnDark]}>{labelRight}</Text>
          )}
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
    borderRadius: radii.md + 2,
    borderWidth: 1,
    padding: spacing.lg - 2,
  },
  compact: {
    borderRadius: radii.md - 2,
    padding: spacing.md,
  },
  dark: {
    backgroundColor: colors.surfaceDark,
    borderColor: colors.borderOnDark,
  },
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.sm + 1,
  },
  label: {
    ...type.label,
    color: colors.textMuted,
  },
  labelOnDark: {
    color: 'rgba(244, 241, 232, 0.55)',
  },
});
