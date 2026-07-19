import { ActivityIndicator, Pressable, StyleSheet, Text, ViewStyle } from 'react-native';

import { colors, fonts, minTapTarget, palette, radii } from '@/theme';

interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  dark?: boolean;
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
}

/** Route Green primary CTA and outlined secondary, per the mockup. */
export function Button({
  label,
  onPress,
  variant = 'primary',
  dark = false,
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
        isSecondary && dark && styles.secondaryDark,
        (disabled || loading) && styles.disabled,
        pressed && styles.pressed,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={isSecondary ? colors.text : palette.mapIvory} />
      ) : (
        <Text
          style={[
            styles.label,
            isSecondary ? styles.labelSecondary : styles.labelPrimary,
            isSecondary && dark && styles.labelSecondaryDark,
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
    borderRadius: radii.sm + 4,
    height: minTapTarget,
    justifyContent: 'center',
    paddingHorizontal: 18,
    width: '100%',
  },
  primary: {
    backgroundColor: palette.routeGreen,
  },
  secondary: {
    backgroundColor: 'transparent',
    borderColor: 'rgba(30, 35, 39, 0.18)',
    borderWidth: 1,
  },
  danger: {
    backgroundColor: colors.danger,
  },
  secondaryDark: {
    borderColor: 'rgba(244, 241, 232, 0.20)',
  },
  disabled: {
    opacity: 0.45,
  },
  pressed: {
    opacity: 0.85,
  },
  label: {
    fontFamily: fonts.black,
    fontSize: 14,
    letterSpacing: -0.2,
  },
  labelPrimary: {
    color: palette.mapIvory,
  },
  labelSecondary: {
    color: colors.text,
  },
  labelSecondaryDark: {
    color: colors.textOnDark,
  },
});
