import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { Card, MetricTile, Pill, RouteBand, Screen } from '@/components';
import { colors, spacing, type } from '@/theme';

/**
 * Home command center (Loop 2). Empty state until the capture, load, mileage,
 * and RPM loops land — every band already navigates like the real board will.
 */
export default function DashboardScreen() {
  const router = useRouter();

  return (
    <Screen
      kicker="Command Center"
      title="Your road board is ready."
      headerRight={<Pill label="This Week" tone="blue" />}
    >
      <Card dark label="This Week" labelRight="No records yet">
        <Text style={styles.heroMetric}>$—/mi</Text>
        <Text style={styles.heroCopy}>
          Start capturing receipts, loads, and miles to see spend, rate per mile, and money owed
          here.
        </Text>
        <View style={styles.metricRow}>
          <MetricTile dark label="Target" value="—" />
          <MetricTile dark label="CPM" value="—" />
          <MetricTile dark label="Owed" value="—" />
        </View>
      </Card>

      <View style={styles.sectionGap} />
      <Text style={styles.sectionLabel}>First moves</Text>

      <RouteBand
        marker="1"
        markerTone="green"
        title="Scan your first receipt"
        subtitle="Fuel, lumper, repairs, meals — capture it before it fades."
        value="Go"
        onPress={() => router.push('/scan')}
      />
      <RouteBand
        marker="2"
        markerTone="blue"
        title="Create your first load"
        subtitle="One folder per run: BOL, POD, rate con, lumper, detention."
        value="Go"
        onPress={() => router.push('/loads')}
      />
      <RouteBand
        marker="3"
        markerTone="amber"
        title="Start tracking miles"
        subtitle="Loaded and deadhead miles feed cost per mile."
        value="Go"
        onPress={() => router.push('/miles')}
      />
      <RouteBand
        marker="4"
        markerTone="rust"
        title="Set your RPM target"
        subtitle="Know the rate you need before you take the load."
        value="Go"
        onPress={() => router.push('/reports')}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  heroMetric: {
    ...type.metricLg,
    color: colors.textOnDark,
    marginBottom: spacing.sm,
  },
  heroCopy: {
    ...type.body,
    color: 'rgba(244, 241, 232, 0.72)',
  },
  metricRow: {
    flexDirection: 'row',
    gap: spacing.sm + 2,
    marginTop: spacing.lg - 2,
  },
  sectionGap: {
    height: spacing.lg,
  },
  sectionLabel: {
    ...type.label,
    color: colors.textMuted,
    marginBottom: spacing.xs,
  },
});
