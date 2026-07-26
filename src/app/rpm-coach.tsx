import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Card, Pill } from '@/components';
import { CostProfile, estimateAllMileTargets, QUICK_ESTIMATE_PROFILE } from '@/domain';
import { useActivationStore } from '@/store/activation';
import { useCostProfileStore } from '@/store/costProfile';
import { colors, palette, radii, spacing, type } from '@/theme';

const FIELDS: {
  key: keyof CostProfile;
  label: string;
  hint: string;
  prefix?: string;
  suffix?: string;
}[] = [
  {
    key: 'fixedWeeklyCosts',
    label: 'Fixed weekly costs',
    hint: 'Truck & trailer payments, insurance, permits, ELD — anything you owe whether you roll or not.',
    prefix: '$',
  },
  {
    key: 'variableCostPerMile',
    label: 'Variable cost per mile',
    hint: 'Fuel, DEF, maintenance and tire reserves, repairs — what each mile actually costs.',
    prefix: '$',
  },
  {
    key: 'projectedTotalMiles',
    label: 'Planned miles per week',
    hint: 'Loaded + deadhead. Your break-even spreads fixed costs across every mile.',
    suffix: 'mi',
  },
  {
    key: 'desiredDriverPay',
    label: 'Your pay per week',
    hint: 'What you want to take home before profit.',
    prefix: '$',
  },
  {
    key: 'desiredProfitReserve',
    label: 'Profit reserve per week',
    hint: 'Set aside for the truck fund, taxes, and slow weeks.',
    prefix: '$',
  },
];

/** RPM Coach: set real truck costs so Rate Checks compare against your numbers. */
export default function RpmCoachScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const saved = useCostProfileStore((s) => s.profile);
  const setProfile = useCostProfileStore((s) => s.setProfile);

  const base = saved ?? QUICK_ESTIMATE_PROFILE;
  const [values, setValues] = useState<Record<keyof CostProfile, string>>({
    fixedWeeklyCosts: String(base.fixedWeeklyCosts),
    variableCostPerMile: String(base.variableCostPerMile),
    projectedTotalMiles: String(base.projectedTotalMiles),
    desiredDriverPay: String(base.desiredDriverPay),
    desiredProfitReserve: String(base.desiredProfitReserve),
  });

  const set = (key: keyof CostProfile, v: string) =>
    setValues((prev) => ({ ...prev, [key]: v.replace(/[^0-9.]/g, '') }));

  const profile: CostProfile = useMemo(
    () => ({
      fixedWeeklyCosts: Number(values.fixedWeeklyCosts) || 0,
      variableCostPerMile: Number(values.variableCostPerMile) || 0,
      projectedTotalMiles: Number(values.projectedTotalMiles) || 0,
      desiredDriverPay: Number(values.desiredDriverPay) || 0,
      desiredProfitReserve: Number(values.desiredProfitReserve) || 0,
    }),
    [values],
  );

  const targets = useMemo(() => estimateAllMileTargets(profile), [profile]);
  // Weekly revenue needed = fixed + variable×miles + your pay + profit reserve.
  const revenue =
    profile.fixedWeeklyCosts +
    profile.variableCostPerMile * profile.projectedTotalMiles +
    profile.desiredDriverPay +
    profile.desiredProfitReserve;
  const milesValid = profile.projectedTotalMiles > 0;

  const save = () => {
    if (!milesValid) return;
    setProfile(profile);
    useActivationStore.getState().setCostsAdded(true);
    router.back();
  };

  const resetToEstimate = () => {
    setValues({
      fixedWeeklyCosts: String(QUICK_ESTIMATE_PROFILE.fixedWeeklyCosts),
      variableCostPerMile: String(QUICK_ESTIMATE_PROFILE.variableCostPerMile),
      projectedTotalMiles: String(QUICK_ESTIMATE_PROFILE.projectedTotalMiles),
      desiredDriverPay: String(QUICK_ESTIMATE_PROFILE.desiredDriverPay),
      desiredProfitReserve: String(QUICK_ESTIMATE_PROFILE.desiredProfitReserve),
    });
  };

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <View style={styles.headerRow}>
          <Text style={styles.kicker}>Freight Intelligence</Text>
          <Pressable
            accessibilityLabel="Close"
            onPress={() => router.back()}
            style={styles.closeBtn}
          >
            <Text style={styles.closeText}>✕</Text>
          </Pressable>
        </View>
        <View style={styles.titleRow}>
          <Text style={styles.title}>RPM Coach</Text>
          <Pill
            label={saved ? 'Saved profile' : 'Quick Estimate'}
            tone={saved ? 'green' : 'neutral'}
          />
        </View>
        <Text style={styles.subtitle}>
          Set your real costs once. Every Rate Check then measures a load against your break-even
          and target — not a generic estimate.
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + spacing.xxl }]}
        keyboardShouldPersistTaps="handled"
      >
        <Card dark label="Your numbers" style={styles.resultCard}>
          <View style={styles.metricRow}>
            <Metric
              label="Break-even · all-mile"
              value={targets ? `$${targets.breakEvenAllMileRpm.toFixed(2)}` : '—'}
            />
            <Metric
              label="Target · all-mile"
              value={targets ? `$${targets.targetAllMileRpm.toFixed(2)}` : '—'}
              accent
            />
            <Metric
              label="Weekly revenue need"
              value={milesValid ? `$${Math.round(revenue).toLocaleString()}` : '—'}
            />
          </View>
          {!milesValid && (
            <Text style={styles.warn}>Enter planned miles above zero to see your numbers.</Text>
          )}
        </Card>

        <View style={styles.form}>
          {FIELDS.map((f, i) => (
            <View key={f.key} style={[styles.field, i === FIELDS.length - 1 && styles.fieldLast]}>
              <Text style={styles.fieldLabel}>{f.label}</Text>
              <View style={styles.inputRow}>
                {f.prefix && <Text style={styles.affix}>{f.prefix}</Text>}
                <TextInput
                  value={values[f.key]}
                  onChangeText={(v) => set(f.key, v)}
                  keyboardType="decimal-pad"
                  style={styles.input}
                  placeholder="0"
                  placeholderTextColor="rgba(244,241,232,0.3)"
                  accessibilityLabel={f.label}
                />
                {f.suffix && <Text style={styles.affix}>{f.suffix}</Text>}
              </View>
              <Text style={styles.fieldHint}>{f.hint}</Text>
            </View>
          ))}
        </View>

        <View style={styles.actions}>
          <Button label="Save My Costs" disabled={!milesValid} onPress={save} />
          <Button label="Reset to Quick Estimate" variant="secondary" onPress={resetToEstimate} />
        </View>
      </ScrollView>
    </View>
  );
}

function Metric({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={[styles.metricValue, accent && styles.metricAccent]}>{value}</Text>
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
  titleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  title: { ...type.h1, color: colors.text },
  subtitle: { ...type.body, color: colors.textMuted, marginTop: spacing.sm },
  body: { paddingHorizontal: spacing.xl, paddingTop: spacing.lg },
  resultCard: { marginBottom: spacing.lg },
  metricRow: { flexDirection: 'row', flexWrap: 'wrap' },
  metric: { paddingVertical: spacing.sm, width: '50%' },
  metricLabel: { ...type.labelTiny, color: 'rgba(244, 241, 232, 0.55)', marginBottom: 4 },
  metricValue: {
    color: colors.textOnDark,
    fontFamily: type.metric.fontFamily,
    fontSize: 24,
    fontVariant: ['tabular-nums'],
    letterSpacing: -1,
  },
  metricAccent: { color: palette.routeGreen2 },
  warn: { ...type.bodySmall, color: palette.fuelAmber, marginTop: spacing.sm },
  form: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    paddingHorizontal: spacing.lg,
  },
  field: {
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    paddingVertical: spacing.md,
  },
  fieldLast: { borderBottomWidth: 0 },
  fieldLabel: { ...type.emphasis, color: colors.text },
  inputRow: { alignItems: 'center', flexDirection: 'row', gap: 6, marginTop: 6 },
  affix: { ...type.emphasis, color: colors.textMuted, fontSize: 18 },
  input: {
    color: colors.text,
    flex: 1,
    fontFamily: type.metricSm.fontFamily,
    fontSize: 20,
    fontVariant: ['tabular-nums'],
    padding: 0,
  },
  fieldHint: { ...type.bodySmall, color: colors.textMuted, marginTop: 6 },
  actions: { gap: spacing.sm + 2, marginTop: spacing.xl },
});
