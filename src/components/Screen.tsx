import { ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, spacing, type } from '@/theme';

import { TopoBackground } from './TopoBackground';

interface ScreenProps {
  /** Small uppercase kicker above the title ("map margin" label). */
  kicker: string;
  title: string;
  /** Right side of the header row, e.g. a Pill. */
  headerRight?: ReactNode;
  children: ReactNode;
  dark?: boolean;
}

/** Standard tab screen scaffold: topo backdrop, kicker + title, scrollable body. */
export function Screen({ kicker, title, headerRight, children, dark }: ScreenProps) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.root, dark && styles.rootDark]}>
      <TopoBackground onDark={dark} opacity={dark ? 0.09 : 0.12} />
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + spacing.lg, paddingBottom: spacing.xxl * 3 },
        ]}
      >
        <View style={styles.topline}>
          <View style={styles.titleBlock}>
            <Text style={[styles.kicker, dark && styles.kickerOnDark]}>{kicker}</Text>
            <Text style={[styles.title, dark && styles.titleOnDark]}>{title}</Text>
          </View>
          {headerRight}
        </View>
        {children}
      </ScrollView>
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
  content: {
    paddingHorizontal: spacing.xl,
  },
  topline: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
    marginBottom: spacing.lg + 2,
  },
  titleBlock: {
    flex: 1,
  },
  kicker: {
    ...type.label,
    color: colors.textMuted,
    marginBottom: 6,
  },
  kickerOnDark: {
    color: 'rgba(244, 241, 232, 0.55)',
  },
  title: {
    ...type.h1,
    color: colors.text,
  },
  titleOnDark: {
    color: colors.textOnDark,
  },
});
