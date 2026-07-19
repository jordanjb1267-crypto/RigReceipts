import { useRouter } from 'expo-router';
import { Alert, Share, StyleSheet, Text } from 'react-native';

import { Card, Pill, RouteBand, Screen } from '@/components';
import { isFeatureEnabled } from '@/config/flags';
import { buildCsv, CsvColumn, SCAN_TYPES } from '@/domain';
import { Capture, useCapturesStore } from '@/store/captures';
import { colors, spacing, type } from '@/theme';

const scanLabel = (slug: string) => SCAN_TYPES.find((t) => t.slug === slug)?.label ?? slug;

const CAPTURE_CSV_COLUMNS: CsvColumn<Capture>[] = [
  { header: 'Date', value: (c) => c.date ?? new Date(c.createdAt).toISOString().slice(0, 10) },
  { header: 'Type', value: (c) => scanLabel(c.scanType) },
  { header: 'Vendor', value: (c) => c.vendor },
  { header: 'Amount (USD)', value: (c) => c.totalUsd },
  { header: 'Gallons', value: (c) => c.gallons },
  { header: 'Synced', value: (c) => (c.status === 'synced' ? 'yes' : 'pending') },
];

/**
 * Reports: calendar, daily bulletins, grades, monthly closeout, exports
 * (Loops 9–11). Also the entry to Freight Intelligence (Rate Board), flag-gated.
 */
export default function ReportsScreen() {
  const router = useRouter();
  const boardEnabled = isFeatureEnabled('community_rate_board_enabled');
  const brokerCheckEnabled = isFeatureEnabled('broker_check_enabled');
  const captures = useCapturesStore((s) => s.captures);

  const exportCsv = async () => {
    if (captures.length === 0) {
      Alert.alert('Nothing to export yet', 'Scan a receipt or two, then export your records here.');
      return;
    }
    const csv = buildCsv(CAPTURE_CSV_COLUMNS, captures);
    try {
      await Share.share({ title: 'RigReceipts expenses (CSV)', message: csv });
    } catch {
      // dismissed
    }
  };

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
        value="Set"
        onPress={() => router.push('/rpm-coach')}
      />
      <RouteBand
        marker="G"
        markerTone="blue"
        title="Weekly & monthly grades"
        subtitle="Rate, fuel, deadhead, paperwork, money owed — coached, not shamed."
        value="Soon"
      />
      {brokerCheckEnabled && (
        <RouteBand
          marker="B"
          markerTone="rust"
          title="Broker Check"
          subtitle="Your private log of how each broker pays — on time, in full, detention honored."
          value="Open"
          onPress={() => router.push('/broker-check')}
        />
      )}
      <RouteBand
        marker="✓"
        markerTone="amber"
        title="Export records (CSV)"
        subtitle="Share your captured expenses as a spreadsheet for taxes or your accountant."
        value="Export"
        onPress={exportCsv}
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
