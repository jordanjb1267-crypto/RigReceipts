import { useRouter } from 'expo-router';
import { StyleSheet, Text } from 'react-native';

import { Card, Pill, RouteBand, Screen } from '@/components';
import { isFeatureEnabled } from '@/config/flags';
import { colors, spacing, type } from '@/theme';

/**
 * Reports: calendar, daily bulletins, grades, monthly closeout, exports
 * (Loops 9–11). Also the entry to Freight Intelligence (Rate Board), flag-gated.
 */
export default function ReportsScreen() {
  const router = useRouter();
  const boardEnabled = isFeatureEnabled('community_rate_board_enabled');

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

      {boardEnabled && (
        <RouteBand
          marker="≈"
          markerTone="green"
          title="Community Rate Board"
          subtitle="Recent driver-shared rates by lane and equipment."
          value="Open"
          onPress={() => router.push('/rate-board')}
        />
      )}

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
      <RouteBand
        marker="⚙"
        markerTone="neutral"
        title="Account &amp; data"
        subtitle="Export a copy of your data or delete your account."
        value="Open"
        onPress={() => router.push('/account-settings')}
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
