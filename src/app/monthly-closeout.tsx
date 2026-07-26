import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { Alert, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, MetricTile } from '@/components';
import {
  buildCsv,
  CsvColumn,
  expensesInRange,
  monthRange,
  SCAN_TYPES,
  summarizeRange,
} from '@/domain';
import { Capture, useCapturesStore } from '@/store/captures';
import { colors, palette, radii, spacing, type } from '@/theme';

const usd = (n: number) =>
  `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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
 * Monthly Closeout: the current month's real spend, computed from the local
 * capture queue — total, records, fuel, a category breakdown, and a
 * month-scoped CSV export. All numbers are the driver's own captured receipts.
 */
export default function MonthlyCloseoutScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const captures = useCapturesStore((s) => s.captures);

  const range = useMemo(() => monthRange(new Date()), []);
  const monthCaptures = useMemo(() => expensesInRange(captures, range), [captures, range]);
  const summary = useMemo(() => summarizeRange(captures, range), [captures, range]);
  const maxCat = summary.byCategory[0]?.totalUsd ?? 0;

  const exportMonth = async () => {
    if (monthCaptures.length === 0) {
      Alert.alert('Nothing to export yet', `No records captured in ${range.label}.`);
      return;
    }
    const csv = buildCsv(CAPTURE_CSV_COLUMNS, monthCaptures);
    try {
      await Share.share({ title: `RigReceipts — ${range.label} (CSV)`, message: csv });
    } catch {
      // dismissed
    }
  };

  const hasRecords = summary.expenseCount + summary.documentCount > 0;

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <View style={styles.headerRow}>
          <Text style={styles.kicker}>Monthly Atlas</Text>
          <Pressable
            accessibilityLabel="Close"
            onPress={() => router.back()}
            style={styles.closeBtn}
          >
            <Text style={styles.closeText}>✕</Text>
          </Pressable>
        </View>
        <Text style={styles.title}>{range.label} closeout</Text>
        <Text style={styles.subtitle}>Your captured spend this month, ready for the books.</Text>
      </View>

      <ScrollView
        contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + spacing.xxl }]}
      >
        {!hasRecords ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>No records yet this month.</Text>
            <Text style={styles.cardCopy}>
              Scan a receipt on the Scan tab and it lands here automatically — spend, category
              breakdown, and a spreadsheet export for your accountant.
            </Text>
          </View>
        ) : (
          <>
            <View style={styles.card}>
              <Text style={styles.totalLabel}>Total spend</Text>
              <Text style={styles.total}>{usd(summary.totalUsd)}</Text>
              <View style={styles.metricRow}>
                <MetricTile label="Records" value={String(summary.expenseCount)} />
                <MetricTile label="Documents" value={String(summary.documentCount)} />
                <MetricTile
                  label="Fuel"
                  value={summary.fuelGallons > 0 ? `${Math.round(summary.fuelGallons)} gal` : '—'}
                />
              </View>
            </View>

            {summary.byCategory.length > 0 && (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Where it went</Text>
                {summary.byCategory.map((c) => (
                  <View key={c.category} style={styles.catRow}>
                    <View style={styles.catHead}>
                      <Text style={styles.catLabel}>{c.label}</Text>
                      <Text style={styles.catAmount}>{usd(c.totalUsd)}</Text>
                    </View>
                    <View style={styles.barTrack}>
                      <View
                        style={[
                          styles.barFill,
                          {
                            width: `${maxCat > 0 ? Math.max(4, (c.totalUsd / maxCat) * 100) : 0}%`,
                          },
                        ]}
                      />
                    </View>
                    <Text style={styles.catCount}>
                      {c.count} {c.count === 1 ? 'record' : 'records'}
                    </Text>
                  </View>
                ))}
              </View>
            )}

            <Button label={`Export ${range.label} (CSV)`} onPress={exportMonth} />
            <Text style={styles.footNote}>
              Exports every record captured this month. Amounts come straight from your scans — no
              estimates.
            </Text>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: colors.background, flex: 1 },
  header: { paddingHorizontal: spacing.xl },
  headerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  kicker: { ...type.label, color: colors.textMuted },
  closeBtn: {
    alignItems: 'center',
    backgroundColor: 'rgba(244, 241, 232, 0.06)',
    borderRadius: radii.sm,
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  closeText: { color: colors.text, fontSize: 15 },
  title: { ...type.h1, color: colors.text, marginTop: spacing.sm },
  subtitle: { ...type.body, color: colors.textMuted, marginTop: spacing.xs },
  body: { paddingHorizontal: spacing.xl, paddingTop: spacing.lg },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    marginBottom: spacing.md,
    padding: spacing.lg,
  },
  cardTitle: { ...type.h2, color: colors.text, marginBottom: spacing.md },
  cardCopy: { ...type.body, color: colors.textMuted },
  totalLabel: { ...type.labelTiny, color: colors.textMuted },
  total: {
    color: colors.text,
    fontFamily: type.metricLg.fontFamily,
    fontSize: 40,
    fontVariant: ['tabular-nums'],
    letterSpacing: -1.5,
    marginTop: 4,
  },
  metricRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },
  catRow: { marginBottom: spacing.md },
  catHead: {
    alignItems: 'baseline',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  catLabel: { ...type.emphasis, color: colors.text, flex: 1 },
  catAmount: { ...type.emphasis, color: colors.text, fontVariant: ['tabular-nums'] },
  barTrack: {
    backgroundColor: 'rgba(244, 241, 232, 0.08)',
    borderRadius: 999,
    height: 6,
    overflow: 'hidden',
  },
  barFill: { backgroundColor: palette.routeGreen, borderRadius: 999, height: '100%' },
  catCount: { ...type.labelTiny, color: colors.textMuted, marginTop: 4 },
  footNote: {
    ...type.bodySmall,
    color: colors.textMuted,
    marginTop: spacing.md,
    textAlign: 'center',
  },
});
