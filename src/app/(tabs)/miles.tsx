import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Card, MetricTile, Pill, RouteBand, Screen } from '@/components';
import { isFeatureEnabled } from '@/config/flags';
import {
  ACCOUNTING_LABELS,
  activeSegment,
  costPerMile,
  effectiveMiles,
  FREE_LIMITS,
  monthRange,
  summarizeRange,
  summarizeSegments,
  summarizeTrips,
  tripsInRange,
  unclassifiedMiles,
} from '@/domain';
import { useCapturesStore } from '@/store/captures';
import { useMileageStore } from '@/store/mileage';
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

  const liveEnabled = isFeatureEnabled('live_mileage_core_enabled');
  const segments = useMileageStore((s) => s.segments);
  const active = liveEnabled ? activeSegment(segments) : null;
  const needsReview = liveEnabled ? unclassifiedMiles(segments) : 0;
  const segReport = useMemo(() => summarizeSegments(segments), [segments]);
  const showSegReport = liveEnabled && segments.length > 0;
  const liveSubtitle = active
    ? `${ACCOUNTING_LABELS[active.accountingCategory]} · ${effectiveMiles(active).toLocaleString(undefined, { maximumFractionDigits: 1 })} mi this segment`
    : 'Start a session — deadhead to delivery, driver-confirmed.';

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
      {liveEnabled && (
        <>
          <RouteBand
            marker="▶"
            markerTone={active ? 'green' : 'blue'}
            title="Live Mileage"
            subtitle={liveSubtitle}
            value={active ? 'Live' : 'Track'}
            onPress={() => router.push('/live-mileage')}
          />
          {needsReview > 0 && (
            <RouteBand
              marker="!"
              markerTone="rust"
              title={`${needsReview.toLocaleString(undefined, { maximumFractionDigits: 1 })} mi need review`}
              subtitle="Classify these miles to keep your deadhead and all-mile RPM accurate."
              value="Review"
              onPress={() => router.push('/mileage-review')}
            />
          )}
        </>
      )}

      {showSegReport && (
        <Card
          label="Mileage report"
          labelRight={
            segReport.deadheadRate !== null
              ? `${Math.round(segReport.deadheadRate * 100)}% deadhead`
              : undefined
          }
          style={styles.card}
        >
          <MileRow label="Total business miles" value={miles(segReport.totalBusiness)} strong />
          <MileRow label="Loaded" value={miles(segReport.loaded)} />
          <MileRow
            label="Empty business"
            value={miles(segReport.totalEmptyBusiness)}
            sub={`Deadhead ${miles(segReport.deadhead)} · Other ${miles(segReport.businessEmpty)}`}
          />
          <MileRow label="Personal" value={miles(segReport.personal)} />
          <MileRow label="Unclassified" value={miles(segReport.unclassified)} />
        </Card>
      )}

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

function MileRow({
  label,
  value,
  sub,
  strong,
}: {
  label: string;
  value: string;
  sub?: string;
  strong?: boolean;
}) {
  return (
    <View style={styles.mileRow}>
      <View style={{ flex: 1 }}>
        <Text style={strong ? styles.mileLabelStrong : styles.mileLabel}>{label}</Text>
        {sub && <Text style={styles.mileSub}>{sub}</Text>}
      </View>
      <Text style={strong ? styles.mileValueStrong : styles.mileValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  metricRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  mileRow: {
    alignItems: 'center',
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    paddingVertical: spacing.sm + 2,
  },
  mileLabel: { ...type.body, color: colors.text },
  mileLabelStrong: { ...type.emphasis, color: colors.text },
  mileSub: { ...type.bodySmall, color: colors.textMuted, marginTop: 2 },
  mileValue: { ...type.emphasis, color: colors.text, fontVariant: ['tabular-nums'] },
  mileValueStrong: {
    color: colors.text,
    fontFamily: type.metricSm.fontFamily,
    fontSize: 18,
    fontVariant: ['tabular-nums'],
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
