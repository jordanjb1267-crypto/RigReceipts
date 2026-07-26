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
  /** Retained for API compatibility (every screen is dark now). */
  dark?: boolean;
}

/** Standard tab screen scaffold: topo backdrop, kicker + title, scrollable body. */
export function Screen({ kicker, title, headerRight, children }: ScreenProps) {
  const insets = useSafeAreaInsets();
  return (
    <View style={styles.root}>
      <TopoBackground opacity={0.06} />
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + spacing.lg, paddingBottom: spacing.xxl * 3 },
        ]}
      >
        <View style={styles.topline}>
          <View style={styles.titleBlock}>
            <Text style={styles.kicker}>{kicker}</Text>
            <Text style={styles.title}>{title}</Text>
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
  content: {
    paddingHorizontal: spacing.xl + 2,
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
    color: colors.textFaint,
    marginBottom: 8,
  },
  title: {
    ...type.h1,
    color: colors.text,
  },
});
