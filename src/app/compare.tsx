import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { track } from '@/analytics';
import { Button, Card, Pill, RouteBand } from '@/components';
import { estimateAllMileTargets, QUICK_ESTIMATE_PROFILE } from '@/domain';
import { effectiveCostProfile, useCostProfileStore } from '@/store/costProfile';
import { colors, spacing, type } from '@/theme';

/** Compare a community rate to the viewer's own costs (Section 16). */
export default function CompareScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ rpm: string; label: string }>();
  const communityRpm = Number(params.rpm) || 0;

  const savedProfile = useCostProfileStore((s) => s.profile);
  const setProfile = useCostProfileStore((s) => s.setProfile);
  const [useQuickEstimate, setUseQuickEstimate] = useState(false);

  const hasCosts = savedProfile !== null || useQuickEstimate;
  const targets = hasCosts ? estimateAllMileTargets(effectiveCostProfile(savedProfile)) : null;

  useEffect(() => {
    if (hasCosts) track('community_rate_compared', {});
  }, [hasCosts]);

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <Text style={styles.kicker}>Compare to My Costs</Text>
        <Text style={styles.title}>{params.label ?? 'This lane'}</Text>
      </View>

      <ScrollView
        contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + spacing.xxl }]}
      >
        {!hasCosts ? (
          <>
            <Pill label="Personalize" tone="amber" />
            <Text style={styles.h2}>Make this rate personal</Text>
            <Text style={styles.copy}>
              Add your truck costs to see whether this rate would work for your operation.
            </Text>
            <View style={styles.actions}>
              <Button
                label="Set Up My Costs"
                onPress={() => {
                  // Full cost setup lands later; seed with the Quick Estimate as a start.
                  setProfile(QUICK_ESTIMATE_PROFILE);
                }}
              />
              <Button
                label="Use Quick Estimate"
                variant="secondary"
                onPress={() => setUseQuickEstimate(true)}
              />
            </View>
          </>
        ) : targets ? (
          <>
            <Card dark label="Community Rate" labelRight="all-mile">
              <Text style={styles.big}>${communityRpm.toFixed(2)}</Text>
            </Card>

            <RouteBand
              marker="B"
              markerTone="blue"
              title="Your Break-Even"
              subtitle="All miles"
              value={`$${targets.breakEvenAllMileRpm.toFixed(2)}`}
            />
            <RouteBand
              marker="T"
              markerTone="green"
              title="Your Target"
              subtitle="All miles"
              value={`$${targets.targetAllMileRpm.toFixed(2)}`}
            />

            <Card label="Estimated result for your truck" style={styles.resultCard}>
              <Text style={styles.result}>
                ${(communityRpm - targets.breakEvenAllMileRpm).toFixed(2)}
                <Text style={styles.resultUnit}> per total mile above break-even</Text>
              </Text>
              <Text style={styles.resultNote}>
                {communityRpm >= targets.targetAllMileRpm
                  ? 'This lane has been clearing your target.'
                  : communityRpm >= targets.breakEvenAllMileRpm
                    ? 'Above break-even, but under your target on recent posts.'
                    : 'Recent posts are below your break-even.'}
              </Text>
            </Card>

            <View style={styles.actions}>
              <Button label="Run Full Rate Check" onPress={() => router.back()} />
              <Button label="Save This Lane" variant="secondary" onPress={() => router.back()} />
            </View>
            {useQuickEstimate && !savedProfile && (
              <Text style={styles.estimateNote}>
                Using a Quick Estimate. Add your real costs for a sharper comparison.
              </Text>
            )}
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: colors.background, flex: 1 },
  header: { paddingHorizontal: spacing.xl },
  kicker: { ...type.label, color: colors.textMuted },
  title: { ...type.h1, color: colors.text, marginTop: spacing.sm },
  body: { paddingHorizontal: spacing.xl, paddingTop: spacing.lg },
  h2: { ...type.h1, color: colors.text, marginTop: spacing.md },
  copy: { ...type.body, color: colors.textMuted, marginTop: spacing.md },
  big: {
    ...type.metricLg,
    color: colors.textOnDark,
    marginTop: spacing.sm,
  },
  resultCard: { marginTop: spacing.lg },
  result: {
    color: colors.text,
    fontFamily: type.metric.fontFamily,
    fontSize: 30,
    fontVariant: ['tabular-nums'],
    letterSpacing: -1.2,
  },
  resultUnit: { ...type.body, color: colors.textMuted },
  resultNote: { ...type.body, color: colors.textMuted, marginTop: spacing.sm },
  actions: { gap: spacing.sm + 2, marginTop: spacing.xl },
  estimateNote: { ...type.bodySmall, color: colors.textMuted, marginTop: spacing.md },
});
