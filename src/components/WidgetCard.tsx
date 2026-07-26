import { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radii, spacing, type } from '@/theme';

interface WidgetCardProps {
  label: string;
  /** Right side of the header — a value, grade, or pill. */
  headerRight?: ReactNode;
  children: ReactNode;
  onPress?: () => void;
  dark?: boolean;
}

/** Tappable dashboard widget: labeled header with a chevron affordance. */
export function WidgetCard({ label, headerRight, children, onPress, dark }: WidgetCardProps) {
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={label}
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        dark && styles.dark,
        pressed && onPress ? styles.pressed : null,
      ]}
    >
      <View style={styles.header}>
        <Text style={[styles.label, dark && styles.labelOnDark]}>{label}</Text>
        <View style={styles.headerRight}>
          {headerRight}
          {onPress ? <Text style={[styles.chevron, dark && styles.labelOnDark]}>›</Text> : null}
        </View>
      </View>
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.md + 2,
    borderWidth: 1,
    marginTop: spacing.md,
    padding: spacing.lg - 2,
  },
  dark: {
    backgroundColor: colors.surfaceDark,
    borderColor: colors.borderOnDark,
  },
  pressed: {
    opacity: 0.85,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.sm + 2,
  },
  headerRight: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  label: {
    ...type.label,
    color: colors.textMuted,
  },
  labelOnDark: {
    color: 'rgba(244, 241, 232, 0.55)',
  },
  chevron: {
    color: colors.textMuted,
    fontFamily: type.h2.fontFamily,
    fontSize: 20,
    lineHeight: 20,
  },
});
