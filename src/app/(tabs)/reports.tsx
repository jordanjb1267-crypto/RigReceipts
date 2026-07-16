import { StyleSheet, Text } from 'react-native';

import { Card, Pill, RouteBand, Screen } from '@/components';
import { colors, spacing, type } from '@/theme';

/**
 * Reports: calendar, daily bulletins, grades, monthly closeout, exports
 * (Loops 9–11). Interactive pieces arrive in Phases 11–12.
 */
export default function ReportsScreen() {
  return (
    <Screen
      kicker="Monthly Atlas"
      title="Every day gets a cost marker."
      headerRight={<Pill label="0% complete" tone="neutral" />}
    >
      <Card label="This month" labelRight="$0.00">
        <Text style={styles.emptyTitle}>The calendar fills as you track.</Text>
        <Text style={styles.emptyCopy}>
          Each date will show spend, receipts, miles, load activity, and missing paperwork. Tap a
          day for its bulletin.
        </Text>
      </Card>

      <RouteBand
        marker="R"
        markerTone="green"
        title="RPM Coach"
        subtitle="Set fixed costs, pay, and profit targets to get your rate."
        value="Soon"
      />
      <RouteBand
        marker="G"
        markerTone="blue"
        title="Weekly & monthly grades"
        subtitle="Rate, fuel, deadhead, paperwork, money owed — coached, not shamed."
        value="Soon"
      />
      <RouteBand
        marker="✓"
        markerTone="amber"
        title="Monthly closeout"
        subtitle="Confirm records, export PDF/CSV, lock the month."
        value="Soon"
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  emptyTitle: {
    ...type.h2,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  emptyCopy: {
    ...type.body,
    color: colors.textMuted,
  },
});
