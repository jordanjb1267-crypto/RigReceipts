import { ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, spacing } from '@/theme';

import { TopoBackground } from './TopoBackground';

interface OnboardingShellProps {
  children: ReactNode;
  /** Pinned CTA area at the bottom. */
  footer?: ReactNode;
  dark?: boolean;
  /** Optional progress: current step out of total, rendered as dots. */
  step?: number;
  steps?: number;
}

/** Shared scaffold for onboarding screens: topo backdrop, safe insets, footer. */
export function OnboardingShell({ children, footer, dark, step, steps }: OnboardingShellProps) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.root, dark && styles.rootDark]}>
      <TopoBackground onDark={dark} opacity={dark ? 0.09 : 0.12} />
      <View style={{ flex: 1, paddingTop: insets.top + spacing.lg }}>
        {step !== undefined && steps !== undefined && (
          <View style={styles.dots}>
            {Array.from({ length: steps }).map((_, i) => (
              <View
                key={i}
                style={[
                  styles.dot,
                  dark && styles.dotDark,
                  i < step && (dark ? styles.dotOnDarkActive : styles.dotActive),
                ]}
              />
            ))}
          </View>
        )}
        <ScrollView
          contentContainerStyle={styles.body}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>
        {footer && (
          <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.lg }]}>
            {footer}
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    backgroundColor: colors.background,
    flex: 1,
  },
  rootDark: {
    backgroundColor: colors.surfaceDark,
  },
  body: {
    flexGrow: 1,
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.lg,
  },
  footer: {
    gap: spacing.sm + 2,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
  },
  dots: {
    flexDirection: 'row',
    gap: 6,
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.xl,
  },
  dot: {
    backgroundColor: 'rgba(30, 35, 39, 0.12)',
    borderRadius: 999,
    height: 4,
    flex: 1,
  },
  dotDark: {
    backgroundColor: 'rgba(244, 241, 232, 0.14)',
  },
  dotActive: {
    backgroundColor: colors.cta,
  },
  dotOnDarkActive: {
    backgroundColor: colors.textOnDark,
  },
});
