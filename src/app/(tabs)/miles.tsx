import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Card, MetricTile, Pill, RouteBand, Screen } from '@/components';
import {
  costPerMile,
  FREE_LIMITS,
  monthRange,
  summarizeRange,
  summarizeTrips,
  tripsInRange,
} from '@/domain';
import { useCapturesStore } from '@/store/captures';
import { useTripsStore } from '@/store/trips';
import { colors, palette, spacing, type } from '@/theme';

const miles = (n: number) => n.toLocaleString();
const usd = (n: number) =>
  `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Mileage ledger (Loop 7). Manual trip entry is live; loaded/deadhead totals
 * and actual cost per mile are computed from entered trips + captured expenses.
 * Live GPS tracking (Phase 10) lands later — it needs on-device background
 * location.
 */
export default function MilesScreen() {
  const router = useRouter();
  const trips = useTripsStore((s) => s.trips);
  const removeTrip = useTripsStore((s) => s.removeTrip);
  const captures = useCapturesStore((s) => s.captures);

  const month = useMemo(() => monthRange(new Date()), []);
  const allTime = useMemo(() => summarizeTrips(trips), [trips]);
  const monthMiles = useMemo(() => summarizeTrips(tripsInRange(trips, month)), [trips, month]);
  const monthSpend = useMemo(() => summarizeRange(captures, month), [captures, month]);
  const monthCpm = costPerMile(monthSpend.totalUsd, monthMiles.totalMiles);

  const hasTrips = trips.length > 0;

  return (
    <Screen
      kicker="Mileage Ledger"
      title="All miles count against profit."
      headerRight={
        <Pill
          label={hasTrips ? `${miles(allTime.totalMiles)} mi` : 'Not tracking'}
          tone={hasTrips ? 'green' : 'neutral'}
        />
      }
    >
      <View style={styles.metricRow}>
        <MetricTile label="Total" value={hasTrips ? miles(allTime.totalMiles) : '—'} />
        <MetricTile label="Loaded" value={hasTrips ? miles(allTime.loadedMiles) : '—'} />
        <MetricTile label="Deadhead" value={hasTrips ? miles(allTime.deadheadMiles) : '—'} />
      </View>

      {hasTrips && (
        <Card
          label={`This month · ${month.label}`}
          labelRight={monthCpm !== null ? `${usd(monthCpm)}/mi` : '—'}
          style={styles.card}
        >
          <Text style={styles.cpmNote}>
            {monthMiles.totalMiles > 0
              ? `${miles(monthMiles.totalMiles)} miles this month`
              : 'No miles logged this month yet'}
            {monthMiles.deadheadPct !== null
              ? ` · ${Math.round(monthMiles.deadheadPct * 100)}% deadhead`
              : ''}
            .
          </Text>
          {monthCpm !== null ? (
            <Text style={styles.cpmCopy}>
              {usd(monthSpend.totalUsd)} in captured expenses over {miles(monthMiles.totalMiles)}{' '}
              miles — that is your real cost per mile this month.
            </Text>
          ) : (
            <Text style={styles.cpmCopy}>
              Log miles and scan receipts this month to see your real cost per mile.
            </Text>
          )}
        </Card>
      )}

      <RouteBand
        marker="＋"
        markerTone="green"
        title="Add a trip"
        subtitle="Enter loaded and deadhead miles for a run."
        value="Add"
        onPress={() => router.push('/add-trip')}
      />

      {hasTrips ? (
        <Card label="Trips" labelRight={`${trips.length}`} style={styles.card}>
          {trips.map((t) => (
            <View key={t.id} style={styles.tripRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.tripMiles}>
                  {miles(t.loadedMiles + t.deadheadMiles)} mi
                  <Text style={styles.tripSplit}>
                    {'  '}
                    {miles(t.loadedMiles)} loaded · {miles(t.deadheadMiles)} dh
                  </Text>
                </Text>
                <Text style={styles.tripMeta}>
                  {t.date ?? new Date(t.createdAt).toISOString().slice(0, 10)}
                  {t.note ? ` · ${t.note}` : ''}
                </Text>
              </View>
              <Pressable
                accessibilityLabel="Remove trip"
                hitSlop={8}
                onPress={() => removeTrip(t.id)}
              >
                <Text style={styles.remove}>Remove</Text>
              </Pressable>
            </View>
          ))}
        </Card>
      ) : (
        <Card label="Trips" style={styles.card}>
          <Text style={styles.emptyTitle}>No trips yet.</Text>
          <Text style={styles.emptyCopy}>
            Add trips by hand for now — loaded and deadhead miles feed cost per mile, the RPM Coach,
            and your grades. Live GPS tracking with automatic loaded/deadhead splits lands with the
            mileage loop; location is only requested when you start a trip, and the free plan
            includes {FREE_LIMITS.gpsTripsPerMonth} GPS trips per month.
          </Text>
        </Card>
      )}
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
  cpmNote: { ...type.emphasis, color: colors.text },
  cpmCopy: { ...type.body, color: colors.textMuted, marginTop: spacing.xs },
  tripRow: {
    alignItems: 'center',
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    paddingVertical: spacing.sm + 2,
  },
  tripMiles: { ...type.emphasis, color: colors.text, fontVariant: ['tabular-nums'] },
  tripSplit: { ...type.bodySmall, color: colors.textMuted },
  tripMeta: { ...type.bodySmall, color: colors.textMuted, marginTop: 2 },
  remove: { ...type.labelTiny, color: palette.clayRust },
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
