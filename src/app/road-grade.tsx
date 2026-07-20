import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, GradeBadge } from '@/components';
import { isFeatureEnabled } from '@/config/flags';
import {
  assembleGradeInputs,
  CATEGORY_LABEL,
  CategoryGrade,
  estimateAllMileTargets,
  expensesInRange,
  GradableLoad,
  GradableReceivable,
  gradePeriod,
  isCompletedLoad,
  last7dRange,
  monthRange,
  presentDocTypesForLoad,
  summarizeSegments,
  summarizeTrips,
  tripsInRange,
} from '@/domain';
import { useCapturesStore } from '@/store/captures';
import { useCostProfileStore } from '@/store/costProfile';
import { useLoadDocsStore } from '@/store/loadDocs';
import { useLoadsStore, normalizeLoad } from '@/store/loads';
import { useMileageStore } from '@/store/mileage';
import { useReceivablesStore } from '@/store/receivables';
import { useTripsStore } from '@/store/trips';
import { useTruckProfileStore } from '@/store/truckProfile';
import { colors, radii, spacing, type } from '@/theme';

const daysSince = (iso: string | null, fallbackMs: number, nowMs: number): number => {
  const ms = iso ? Date.parse(iso) : fallbackMs;
  if (Number.isNaN(ms)) return 0;
  return Math.max(0, Math.floor((nowMs - ms) / 86_400_000));
};

/** Road Grade (road_grade_enabled): the honest five-category operating grade. */
export default function RoadGradeScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const enabled = isFeatureEnabled('road_grade_enabled');

  const loads = useLoadsStore((s) => s.loads);
  const trips = useTripsStore((s) => s.trips);
  const segments = useMileageStore((s) => s.segments);
  const captures = useCapturesStore((s) => s.captures);
  const receivables = useReceivablesStore((s) => s.receivables);
  const loadDocs = useLoadDocsStore((s) => s.docs);
  const profile = useCostProfileStore((s) => s.profile);
  const mpg = useTruckProfileStore((s) => s.avgMpg);
  const dieselPrice = useTruckProfileStore((s) => s.dieselPricePerGallon);
  const setTruckProfile = useTruckProfileStore((s) => s.setTruckProfile);

  const [periodKind, setPeriodKind] = useState<'month' | 'week'>('month');

  const grade = useMemo(() => {
    const now = new Date();
    const nowMs = now.getTime();
    const range = periodKind === 'month' ? monthRange(now) : last7dRange(now);
    const rangeLabel = periodKind === 'month' ? (range.label ?? 'this month') : 'the last 7 days';
    const inRange = (ms: number) => ms >= range.startMs && ms < range.endMs;

    const gradableLoads: GradableLoad[] = loads
      .filter((l) => inRange(l.createdAt))
      .map((raw) => {
        const l = normalizeLoad(raw);
        return {
          grossRate: l.grossRate,
          fuelSurcharge: l.fuelSurcharge,
          loadedMiles: l.loadedMiles,
          deadheadMiles: l.deadheadMiles,
          completed: isCompletedLoad(l.status),
          bolRequired: l.bolRequired,
          presentDocTypes: presentDocTypesForLoad(l.id, loadDocs, captures),
        };
      });

    const periodTrips = summarizeTrips(tripsInRange(trips, range));

    // Prefer Live Mileage segments when they carry business miles for the period
    // (one source — never sum segments and trips together).
    const periodSegments = segments.filter((s) => inRange(s.startedAt));
    const seg = summarizeSegments(periodSegments);
    const usingSegments = seg.totalBusiness > 0;
    const deadheadMiles = usingSegments ? seg.deadhead : periodTrips.deadheadMiles;
    const businessMiles = usingSegments ? seg.totalBusiness : periodTrips.totalMiles;

    const fuelCaptures = expensesInRange(captures, range).filter((c) => c.scanType === 'fuel');
    const actualFuelCost = fuelCaptures.reduce((sum, c) => sum + (c.totalUsd ?? 0), 0);
    const gallonsPurchased = fuelCaptures.reduce((sum, c) => sum + (c.gallons ?? 0), 0);

    const gradableReceivables: GradableReceivable[] = receivables
      .filter((r) => inRange(r.dateIncurred ? Date.parse(r.dateIncurred) : r.createdAt))
      .map((r) => ({
        amountExpected: r.amountExpected,
        amountReceived: r.amountReceived,
        status: r.status,
        ageDays: daysSince(r.dateSubmitted ?? r.dateIncurred, r.createdAt, nowMs),
      }));

    const inputs = assembleGradeInputs({
      loads: gradableLoads,
      targets: profile ? estimateAllMileTargets(profile) : null,
      hasCostProfile: profile !== null,
      trips: { deadheadMiles, totalMiles: businessMiles },
      fuel: {
        businessMiles,
        mpg,
        actualFuelCost,
        gallonsPurchased,
        dieselPricePerGallon: dieselPrice,
      },
      receivables: gradableReceivables,
    });
    return { period: gradePeriod(inputs), rangeLabel };
  }, [
    periodKind,
    loads,
    trips,
    segments,
    captures,
    receivables,
    loadDocs,
    profile,
    mpg,
    dieselPrice,
  ]);

  const { period } = grade;

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
        <Text style={styles.title}>Road Grade</Text>
        <Text style={styles.subtitle}>
          How well you operated {grade.rangeLabel} — and where you&apos;re losing money or creating
          risk.
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + spacing.xxl }]}
        keyboardShouldPersistTaps="handled"
      >
        {!enabled ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Road Grade is in beta.</Text>
            <Text style={styles.reason}>
              Your weekly and monthly operating grade lands here soon.
            </Text>
          </View>
        ) : (
          <>
            <View style={styles.segment}>
              {(['month', 'week'] as const).map((k) => (
                <Pressable
                  key={k}
                  accessibilityRole="button"
                  accessibilityLabel={k === 'month' ? 'This month' : 'Last 7 days'}
                  onPress={() => setPeriodKind(k)}
                  style={[styles.segmentBtn, periodKind === k && styles.segmentBtnActive]}
                >
                  <Text style={[styles.segmentText, periodKind === k && styles.segmentTextActive]}>
                    {k === 'month' ? 'This month' : 'Last 7 days'}
                  </Text>
                </Pressable>
              ))}
            </View>
            <OverallCard period={period} />
            {period.categories.map((c) => (
              <CategoryCard key={c.category} grade={c} />
            ))}
            <TruckFuelCard
              mpg={mpg}
              dieselPrice={dieselPrice}
              onSave={(next) => setTruckProfile(next)}
            />
            <Text style={styles.footNote}>
              Grades come only from your own records. Missing a category never counts against you —
              it just waits for the data.
            </Text>
          </>
        )}
      </ScrollView>
    </View>
  );
}

function OverallCard({ period }: { period: ReturnType<typeof gradePeriod> }) {
  if (period.letter === null) {
    return (
      <View style={[styles.card, styles.overallCard]}>
        <Text style={styles.overallPending}>Not enough data to grade this period yet.</Text>
        <Text style={styles.reason}>
          Grading {period.gradableCount} of {period.totalCategories} categories. Add the rest to
          unlock your full Road Grade:
        </Text>
        {period.missing.map((m) => (
          <Text key={m} style={styles.missingItem}>
            • {m}
          </Text>
        ))}
      </View>
    );
  }
  return (
    <View style={[styles.card, styles.overallCard]}>
      <GradeBadge grade={period.letter} size={64} />
      <View style={styles.overallText}>
        <Text style={styles.overallLabel}>Overall</Text>
        <Text style={styles.overallScore}>{period.score}/100</Text>
        <Text style={styles.reason}>{period.summary}</Text>
      </View>
    </View>
  );
}

function CategoryCard({ grade }: { grade: CategoryGrade }) {
  const label = CATEGORY_LABEL[grade.category];
  return (
    <View style={styles.card}>
      <View style={styles.catHead}>
        <Text style={styles.catLabel}>{label}</Text>
        {grade.grade ? (
          <GradeBadge grade={grade.grade} size={30} />
        ) : (
          <View style={styles.pendingChip}>
            <Text style={styles.pendingChipText}>Add data</Text>
          </View>
        )}
      </View>
      <Text style={grade.gradable ? styles.reason : styles.reasonMuted}>{grade.reason}</Text>
    </View>
  );
}

function TruckFuelCard({
  mpg,
  dieselPrice,
  onSave,
}: {
  mpg: number | null;
  dieselPrice: number | null;
  onSave: (next: { avgMpg: number | null; dieselPricePerGallon: number | null }) => void;
}) {
  const [mpgText, setMpgText] = useState(mpg !== null ? String(mpg) : '');
  const [priceText, setPriceText] = useState(dieselPrice !== null ? String(dieselPrice) : '');

  const save = () => {
    const m = Number(mpgText);
    const p = Number(priceText);
    onSave({
      avgMpg: mpgText && m > 0 ? m : null,
      dieselPricePerGallon: priceText && p > 0 ? p : null,
    });
  };

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Truck &amp; fuel</Text>
      <Text style={styles.reasonMuted}>
        Set your average MPG to unlock the Fuel grade. Diesel price is only a fallback when a fuel
        receipt is missing its gallons.
      </Text>
      <View style={styles.fuelRow}>
        <View style={styles.fuelField}>
          <Text style={styles.fieldLabel}>Avg MPG</Text>
          <TextInput
            value={mpgText}
            onChangeText={(v) => setMpgText(v.replace(/[^0-9.]/g, ''))}
            keyboardType="decimal-pad"
            placeholder="6.5"
            placeholderTextColor="rgba(30,35,39,0.3)"
            style={styles.input}
            accessibilityLabel="Average MPG"
          />
        </View>
        <View style={styles.fuelField}>
          <Text style={styles.fieldLabel}>Diesel $/gal</Text>
          <TextInput
            value={priceText}
            onChangeText={(v) => setPriceText(v.replace(/[^0-9.]/g, ''))}
            keyboardType="decimal-pad"
            placeholder="3.90"
            placeholderTextColor="rgba(30,35,39,0.3)"
            style={styles.input}
            accessibilityLabel="Diesel price per gallon"
          />
        </View>
      </View>
      <Button label="Save truck details" variant="secondary" onPress={save} />
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
    backgroundColor: 'rgba(30, 35, 39, 0.06)',
    borderRadius: radii.sm,
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  closeText: { color: colors.text, fontSize: 15 },
  title: { ...type.h1, color: colors.text, marginTop: spacing.sm },
  subtitle: { ...type.body, color: colors.textMuted, marginTop: spacing.xs },
  body: { paddingHorizontal: spacing.xl, paddingTop: spacing.lg },
  segment: {
    backgroundColor: 'rgba(30, 35, 39, 0.06)',
    borderRadius: radii.sm + 2,
    flexDirection: 'row',
    marginBottom: spacing.md,
    padding: 3,
  },
  segmentBtn: {
    alignItems: 'center',
    borderRadius: radii.sm,
    flex: 1,
    paddingVertical: spacing.sm,
  },
  segmentBtnActive: { backgroundColor: colors.surface },
  segmentText: { ...type.labelTiny, color: colors.textMuted },
  segmentTextActive: { color: colors.text },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    marginBottom: spacing.md,
    padding: spacing.lg,
  },
  overallCard: { alignItems: 'center', flexDirection: 'row', gap: spacing.lg },
  overallText: { flex: 1 },
  overallLabel: { ...type.labelTiny, color: colors.textMuted },
  overallScore: {
    color: colors.text,
    fontFamily: type.metricLg.fontFamily,
    fontSize: 26,
    fontVariant: ['tabular-nums'],
    marginTop: 2,
  },
  overallPending: { ...type.h2, color: colors.text, marginBottom: spacing.sm },
  missingItem: { ...type.bodySmall, color: colors.textMuted, marginTop: 6 },
  cardTitle: { ...type.h2, color: colors.text, marginBottom: spacing.sm },
  catHead: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  catLabel: { ...type.h2, color: colors.text, fontSize: 17 },
  reason: { ...type.body, color: colors.text },
  reasonMuted: { ...type.body, color: colors.textMuted, marginBottom: spacing.sm },
  pendingChip: {
    backgroundColor: 'rgba(30, 35, 39, 0.06)',
    borderRadius: radii.pill,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  pendingChipText: { ...type.labelTiny, color: colors.textMuted },
  fuelRow: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.sm,
    marginBottom: spacing.md,
  },
  fuelField: { flex: 1 },
  fieldLabel: { ...type.labelTiny, color: colors.textMuted, marginBottom: 4 },
  input: {
    ...type.body,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    color: colors.text,
    paddingVertical: spacing.sm,
  },
  footNote: {
    ...type.bodySmall,
    color: colors.textMuted,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
});
