import { StyleSheet, Text, View } from 'react-native';

import { Card, MetricTile, Pill, RouteBand, Screen } from '@/components';
import { FREE_LIMITS } from '@/domain';
import { colors, spacing, type } from '@/theme';

/** Mileage ledger (Loop 7). GPS + manual trips arrive in Phase 10. */
export default function MilesScreen() {
  return (
    <Screen
      kicker="Mileage Ledger"
      title="All miles count against profit."
      headerRight={<Pill label="Not tracking" tone="neutral" />}
    >
      <View style={styles.metricRow}>
        <MetricTile label="Total" value="—" />
        <MetricTile label="Loaded" value="—" />
        <MetricTile label="Deadhead" value="—" />
      </View>

      <Card label="Trips" style={styles.card}>
        <Text style={styles.emptyTitle}>No trips yet.</Text>
        <Text style={styles.emptyCopy}>
          GPS tracking with loaded/deadhead breakdown and manual trip entry land with the mileage
          loop. Location permission is only requested when you start a trip. Free plan includes{' '}
          {FREE_LIMITS.gpsTripsPerMonth} GPS trips per month.
        </Text>
      </Card>

      <RouteBand
        marker="⌁"
        markerTone="blue"
        title="Miles feed everything"
        subtitle="Cost per mile, RPM Coach, calendar, and grades all draw from this ledger."
        value="Soon"
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  metricRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  card: {
    marginTop: spacing.md,
  },
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
