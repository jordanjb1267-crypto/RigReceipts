import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Button, Card, OnboardingShell, Pill, RouteBand } from '@/components';
import { breakEvenAllMileRpm, targetLoadedRpm } from '@/domain';
import { FirstJob, useOnboardingStore } from '@/store/onboarding';
import { colors, palette, radii, spacing, type } from '@/theme';

/** O5 · First useful action — branches by the job chosen on O4. */
export default function FirstActionRoute() {
  const router = useRouter();
  const firstJob = useOnboardingStore((s) => s.firstJob);
  const completeFirstAction = useOnboardingStore((s) => s.completeFirstAction);

  const proceed = () => {
    completeFirstAction();
    router.push('/(onboarding)/reveal');
  };

  return (
    <OnboardingShell step={4} steps={5}>
      {firstJob === 'check_rate' ? (
        <RateBranch onDone={proceed} />
      ) : firstJob === 'track_money_owed' ? (
        <MoneyOwedBranch onDone={proceed} />
      ) : (
        <CaptureBranch job={firstJob} onDone={proceed} />
      )}
    </OnboardingShell>
  );
}

// ---------------------------------------------------------------------------
// Capture branch (scan receipt / BOL) — camera + OCR arrive in Phase 6, so this
// simulates a capture and is labeled a demo.
// ---------------------------------------------------------------------------

function CaptureBranch({ job, onDone }: { job: FirstJob | null; onDone: () => void }) {
  const isBol = job === 'save_load_docs';
  const [captured, setCaptured] = useState(false);

  return (
    <>
      <Pill label="Field Capture" tone="green" />
      <Text style={styles.title}>
        {isBol ? 'Save your first load doc.' : 'Scan your first receipt.'}
      </Text>
      <Text style={styles.body}>
        {isBol
          ? 'Frame the BOL and it files into a load folder. Camera opens only when you scan.'
          : 'Frame the receipt and we read the amount, vendor, and date. Camera opens only when you scan.'}
      </Text>

      <View style={[styles.frame, captured && styles.frameDone]}>
        <Text style={styles.frameGlyph}>{captured ? '✓' : '▢'}</Text>
        <Text style={styles.frameCopy}>
          {captured
            ? 'Sample document captured. You will confirm the details before it saves.'
            : 'Camera preview (demo). Live capture + OCR land in the scan phase.'}
        </Text>
      </View>

      <View style={styles.footerInline}>
        {captured ? (
          <Button label="Looks good — continue" onPress={onDone} />
        ) : (
          <Button
            label={isBol ? 'Capture BOL (demo)' : 'Capture receipt (demo)'}
            onPress={() => setCaptured(true)}
          />
        )}
      </View>
    </>
  );
}

// ---------------------------------------------------------------------------
// Money owed branch — minimal amount entry (full workflow is Phase 9).
// ---------------------------------------------------------------------------

function MoneyOwedBranch({ onDone }: { onDone: () => void }) {
  const [kind, setKind] = useState<'detention' | 'lumper'>('detention');
  const [amount, setAmount] = useState(150);

  return (
    <>
      <Pill label="Money Owed" tone="amber" />
      <Text style={styles.title}>Log money you are owed.</Text>
      <Text style={styles.body}>
        Track it now so nothing slips before you invoice or follow up.
      </Text>

      <View style={styles.segment}>
        {(['detention', 'lumper'] as const).map((k) => (
          <Pressable
            key={k}
            onPress={() => setKind(k)}
            style={[styles.segmentItem, kind === k && styles.segmentItemActive]}
          >
            <Text style={[styles.segmentLabel, kind === k && styles.segmentLabelActive]}>
              {k === 'detention' ? 'Detention' : 'Lumper'}
            </Text>
          </Pressable>
        ))}
      </View>

      <Card label="Amount owed" style={styles.amountCard}>
        <Stepper value={amount} onChange={setAmount} step={25} min={0} prefix="$" />
      </Card>

      <View style={styles.footerInline}>
        <Button label={`Add $${amount} ${kind}`} onPress={onDone} />
      </View>
    </>
  );
}

// ---------------------------------------------------------------------------
// Rate branch — real RPM Coach math from src/domain/rpm.ts.
// ---------------------------------------------------------------------------

const STARTER = {
  fixedWeeklyCosts: 1100,
  variableCostPerMile: 1.05,
  projectedTotalMiles: 2600,
  expectedLoadedMiles: 2300,
};

function RateBranch({ onDone }: { onDone: () => void }) {
  const [driverPay, setDriverPay] = useState(1400);
  const [profitReserve, setProfitReserve] = useState(400);

  const { target, breakEven } = useMemo(() => {
    const inputs = {
      ...STARTER,
      desiredDriverPay: driverPay,
      desiredProfitReserve: profitReserve,
    };
    return {
      target: targetLoadedRpm(inputs),
      breakEven: breakEvenAllMileRpm(
        STARTER.fixedWeeklyCosts,
        STARTER.variableCostPerMile,
        STARTER.projectedTotalMiles,
      ),
    };
  }, [driverPay, profitReserve]);

  const fmt = (v: number | null) => (v === null ? '—' : `$${v.toFixed(2)}`);

  return (
    <>
      <Pill label="RPM Coach" tone="green" />
      <Text style={styles.title}>Your starter rate target.</Text>
      <Text style={styles.body}>
        A quick estimate. It sharpens as real expenses and miles build up.
      </Text>

      <Card dark label="Target loaded rate" labelRight="per mile" style={styles.rateCard}>
        <Text style={styles.rateMetric}>{fmt(target)}</Text>
        <Text style={styles.rateNote}>
          Based on {STARTER.expectedLoadedMiles.toLocaleString()} loaded of{' '}
          {STARTER.projectedTotalMiles.toLocaleString()} total miles.
        </Text>
      </Card>

      <RouteBand
        marker="!"
        markerTone="amber"
        title="Break-even (all miles)"
        subtitle="Do not run below this rate."
        value={fmt(breakEven)}
      />

      <Card label="Desired driver pay / week" style={styles.inputCard}>
        <Stepper value={driverPay} onChange={setDriverPay} step={100} min={0} prefix="$" />
      </Card>
      <Card label="Profit / reserve per week" style={styles.inputCard}>
        <Stepper value={profitReserve} onChange={setProfitReserve} step={50} min={0} prefix="$" />
      </Card>

      <View style={styles.footerInline}>
        <Button label="Save my starter target" onPress={onDone} />
      </View>
    </>
  );
}

// ---------------------------------------------------------------------------

function Stepper({
  value,
  onChange,
  step,
  min,
  prefix = '',
}: {
  value: number;
  onChange: (v: number) => void;
  step: number;
  min: number;
  prefix?: string;
}) {
  return (
    <View style={styles.stepper}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Decrease"
        onPress={() => onChange(Math.max(min, value - step))}
        style={styles.stepBtn}
      >
        <Text style={styles.stepGlyph}>−</Text>
      </Pressable>
      <Text style={styles.stepValue}>
        {prefix}
        {value.toLocaleString()}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Increase"
        onPress={() => onChange(value + step)}
        style={styles.stepBtn}
      >
        <Text style={styles.stepGlyph}>+</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  title: {
    ...type.h1,
    color: colors.text,
    marginTop: spacing.lg,
  },
  body: {
    ...type.body,
    color: colors.textMuted,
    marginTop: spacing.md,
  },
  footerInline: {
    marginTop: spacing.xl,
  },
  // capture
  frame: {
    alignItems: 'center',
    backgroundColor: palette.asphalt2,
    borderColor: 'rgba(244, 241, 232, 0.15)',
    borderRadius: radii.lg,
    borderWidth: 1,
    gap: spacing.md,
    marginTop: spacing.xl,
    padding: spacing.xxl,
  },
  frameDone: {
    backgroundColor: 'rgba(46, 107, 87, 0.16)',
    borderColor: palette.routeGreen,
  },
  frameGlyph: {
    color: palette.mapIvory,
    fontFamily: type.h1.fontFamily,
    fontSize: 40,
  },
  frameCopy: {
    ...type.body,
    color: 'rgba(244, 241, 232, 0.66)',
    textAlign: 'center',
  },
  // money owed
  segment: {
    backgroundColor: 'rgba(30, 35, 39, 0.06)',
    borderRadius: radii.sm + 2,
    flexDirection: 'row',
    marginTop: spacing.xl,
    padding: 4,
  },
  segmentItem: {
    alignItems: 'center',
    borderRadius: radii.sm,
    flex: 1,
    paddingVertical: 10,
  },
  segmentItemActive: {
    backgroundColor: colors.surfaceDark,
  },
  segmentLabel: {
    ...type.emphasis,
    color: colors.textMuted,
  },
  segmentLabelActive: {
    color: colors.textOnDark,
  },
  amountCard: {
    marginTop: spacing.md,
  },
  // rate
  rateCard: {
    marginTop: spacing.xl,
  },
  rateMetric: {
    ...type.metricLg,
    color: colors.textOnDark,
    marginVertical: spacing.xs,
  },
  rateNote: {
    ...type.bodySmall,
    color: 'rgba(244, 241, 232, 0.62)',
  },
  inputCard: {
    marginTop: spacing.md,
  },
  // stepper
  stepper: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  stepBtn: {
    alignItems: 'center',
    backgroundColor: 'rgba(30, 35, 39, 0.06)',
    borderRadius: radii.sm,
    height: 44,
    justifyContent: 'center',
    width: 56,
  },
  stepGlyph: {
    color: colors.text,
    fontFamily: type.h1.fontFamily,
    fontSize: 24,
  },
  stepValue: {
    ...type.metricSm,
    color: colors.text,
  },
});
