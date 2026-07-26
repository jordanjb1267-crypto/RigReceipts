import { ActivityIndicator, Pressable, StyleSheet, Text, ViewStyle } from 'react-native';

import { colors, radii, sizes, type } from '@/theme';

interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  /** Retained for API compatibility (buttons are dark-theme now). */
  dark?: boolean;
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
}

/** Fuel Amber pill primary CTA and bordered secondary (Night Atlas). */
export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  style,
}: ButtonProps) {
  const isSecondary = variant === 'secondary';
  const isDanger = variant === 'danger';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || loading }}
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        isSecondary ? styles.secondary : isDanger ? styles.danger : styles.primary,
        (disabled || loading) && styles.disabled,
        pressed && styles.pressed,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={isSecondary ? colors.text : colors.actionInk} />
      ) : (
        <Text
          style={[
            styles.label,
            isSecondary
              ? styles.labelSecondary
              : isDanger
                ? styles.labelDanger
                : styles.labelPrimary,
            (disabled || loading) && styles.labelDisabled,
          ]}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    borderRadius: radii.cta,
    height: sizes.button,
    justifyContent: 'center',
    paddingHorizontal: 18,
    width: '100%',
  },
  primary: {
    backgroundColor: colors.action,
  },
  secondary: {
    backgroundColor: 'transparent',
    borderColor: colors.border,
    borderWidth: 1,
  },
  danger: {
    backgroundColor: 'rgba(169, 74, 59, 0.16)',
    borderColor: 'rgba(169, 74, 59, 0.4)',
    borderWidth: 1,
  },
  disabled: {
    backgroundColor: colors.border,
  },
  pressed: {
    opacity: 0.85,
  },
  label: {
    ...type.button,
  },
  labelPrimary: {
    color: colors.actionInk,
  },
  labelSecondary: {
    color: colors.text,
  },
  labelDanger: {
    color: '#C4655A',
  },
  labelDisabled: {
    color: 'rgba(244, 241, 232, 0.35)',
  },
});
