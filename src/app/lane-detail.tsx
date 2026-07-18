import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Pill } from '@/components';
import {
  computeLaneAggregate,
  EligiblePost,
  EquipmentType,
  equipmentLabel,
  laneKey,
} from '@/domain';
import { useRateBoard } from '@/data/useRateBoard';
import { useRateBoardStore } from '@/store/rateBoard';
import { colors, fonts, palette, radii, spacing, type } from '@/theme';

const CONFIDENCE_LABEL = {
  limited: 'Limited Data',
  developing: 'Developing Sample',
  moderate: 'Moderate Confidence',
  strong: 'Strong Community Sample',
} as const;

/** Lane detail: community snapshot with the Section-18 aggregate thresholds. */
export default function LaneDetailScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ o: string; d: string; e: string }>();

  const [originMetro, originState] = (params.o ?? ',').split(',');
  const [destinationMetro, destinationState] = (params.d ?? ',').split(',');
  const equipmentType = (params.e ?? 'dry_van') as EquipmentType;

  const key = laneKey({
    originMetro,
    originState,
    destinationMetro,
    destinationState,
    equipmentType,
  });
  const toggleWatchedLane = useRateBoardStore((s) => s.toggleWatchedLane);
  const isWatched = useRateBoardStore((s) => s.watchedLanes.includes(key));
  // Same source as the board feed: live posts when signed in, sample otherwise.
  const { data: boardPosts } = useRateBoard();

  const { lanePosts, aggregate } = useMemo(() => {
    const lanePosts = (boardPosts ?? []).filter(
      (p) =>
        laneKey({
          originMetro: p.originMetro,
          originState: p.originState,
          destinationMetro: p.destinationMetro,
          destinationState: p.destinationState,
          equipmentType: p.equipmentType,
        }) === key,
    );
    const eligible: EligiblePost[] = lanePosts.map((p) => ({
      contributorId: p.contributorId,
      loadedRpm: p.loadedRpm ?? 0,
      allMileRpm: p.allMileRpm ?? 0,
      deadheadMiles: p.deadheadMiles ?? 0,
      verificationLevel: p.verificationLevel,
    }));
    return { lanePosts, aggregate: computeLaneAggregate(eligible) };
  }, [key, boardPosts]);

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <Text style={styles.kicker}>Community Lane</Text>
        <Text style={styles.title}>
          {originMetro}, {originState} → {destinationMetro}, {destinationState}
        </Text>
        <Text style={styles.sub}>{equipmentLabel(equipmentType)}</Text>
      </View>

      <ScrollView
        contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + spacing.xxl }]}
      >
        {aggregate ? (
          <>
            <View style={styles.snapshotHeader}>
              <Text style={styles.sectionTitle}>Community Snapshot</Text>
              <Pill label={CONFIDENCE_LABEL[aggregate.confidence]} tone="green" />
            </View>
            <View style={styles.grid}>
              <Stat
                label="7-Day Median All-Mile"
                value={`$${aggregate.medianAllMileRpm.toFixed(2)}`}
              />
              <Stat
                label="7-Day Median Loaded"
                value={`$${aggregate.medianLoadedRpm.toFixed(2)}`}
              />
              <Stat
                label="Verified Range"
                value={`$${aggregate.lowAllMileRpm.toFixed(2)}–${aggregate.highAllMileRpm.toFixed(2)}`}
              />
              <Stat label="Median Deadhead" value={`${aggregate.medianDeadheadMiles} mi`} />
              <Stat label="Verified Posts" value={String(aggregate.postCount)} />
              <Stat label="Contributors" value={String(aggregate.contributorCount)} />
            </View>
            <Text style={styles.disclaimer}>
              Community Rate Range from driver-shared data — not an official or guaranteed market
              rate.
            </Text>
          </>
        ) : (
          <View style={styles.stateCard}>
            <Text style={styles.stateTitle}>Limited Community Data</Text>
            <Text style={styles.stateBody}>
              There are not enough verified rates yet to calculate a reliable lane range.
            </Text>
            <Text style={styles.stateCount}>{lanePosts.length} verified post(s) so far.</Text>
          </View>
        )}

        <View style={styles.actions}>
          <Button
            label="Run Full Rate Check"
            onPress={() =>
              router.push({
                pathname: '/compare',
                params: {
                  rpm: aggregate ? String(aggregate.medianAllMileRpm) : '',
                  label: `${originMetro}, ${originState} → ${destinationMetro}, ${destinationState}`,
                },
              })
            }
          />
          <Button
            label={isWatched ? 'Lane Saved ✓' : 'Save This Lane'}
            variant="secondary"
            onPress={() => toggleWatchedLane(key)}
          />
        </View>
      </ScrollView>
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: colors.background, flex: 1 },
  header: { paddingHorizontal: spacing.xl },
  kicker: { ...type.label, color: colors.textMuted },
  title: { ...type.h1, color: colors.text, marginTop: spacing.sm },
  sub: { ...type.label, color: colors.textMuted, marginTop: spacing.xs },
  body: { paddingHorizontal: spacing.xl, paddingTop: spacing.lg },
  snapshotHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  sectionTitle: { ...type.h2, color: colors.text },
  grid: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    padding: spacing.sm,
  },
  stat: { padding: spacing.md, width: '50%' },
  statLabel: { ...type.labelTiny, color: colors.textMuted, marginBottom: 4 },
  statValue: {
    color: colors.text,
    fontFamily: fonts.black,
    fontSize: 22,
    fontVariant: ['tabular-nums'],
    letterSpacing: -0.8,
  },
  disclaimer: { ...type.bodySmall, color: colors.textMuted, marginTop: spacing.md },
  stateCard: {
    backgroundColor: 'rgba(200, 145, 45, 0.08)',
    borderColor: 'rgba(200, 145, 45, 0.22)',
    borderRadius: radii.md,
    borderWidth: 1,
    padding: spacing.xl,
  },
  stateTitle: { ...type.h2, color: colors.text },
  stateBody: { ...type.body, color: colors.textMuted, marginTop: spacing.sm },
  stateCount: { ...type.labelTiny, color: palette.fuelAmber, marginTop: spacing.md },
  actions: { gap: spacing.sm + 2, marginTop: spacing.xl },
});
