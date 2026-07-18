import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { track } from '@/analytics';
import { Button, Card, OnboardingShell, Pill } from '@/components';
import { isFeatureEnabled } from '@/config/flags';
import {
  analyzeRateCheck,
  estimateAllMileTargets,
  QUICK_ESTIMATE_PROFILE,
  RateCheckResult,
} from '@/domain';
import { parseRateCon, RATE_CON_FIXTURES } from '@/ocr';
import { useOnboardingStore } from '@/store/onboarding';
import { useRateCardStore } from '@/store/rateCard';
import { colors, radii, spacing, type } from '@/theme';

const VERDICT_COPY: Record<
  RateCheckResult['verdict'],
  { label: string; tone: 'green' | 'amber' | 'rust' }
> = {
  above_target: { label: 'ABOVE TARGET', tone: 'green' },
  on_target: { label: 'ON TARGET', tone: 'green' },
  below_target: { label: 'BELOW TARGET', tone: 'amber' },
  below_break_even: { label: 'BELOW BREAK-EVEN', tone: 'rust' },
};

/** O5 · First useful action — branches by the job chosen on O4 (Sections 29–34). */
export default function FirstActionRoute() {
  const firstJob = useOnboardingStore((s) => s.firstJob);

  switch (firstJob) {
    case 'check_rate':
      return <RateCheckBranch />;
    case 'scan_rate_con':
      return <RateConBranch />;
    case 'see_community_rates':
      return <CommunityBranch />;
    case 'track_miles':
      return <SuccessBranch kind="miles" />;
    case 'organize_load':
      return <SuccessBranch kind="load" />;
    default:
      return <SuccessBranch kind="receipt" />;
  }
}

// ---------------------------------------------------------------------------
// Check My Rate (Section 29 → 30)
// ---------------------------------------------------------------------------

function RateCheckBranch() {
  const [offer, setOffer] = useState('2150');
  const [loaded, setLoaded] = useState('720');
  const [deadhead, setDeadhead] = useState('142');
  const [useActualCosts, setUseActualCosts] = useState(false);
  const [result, setResult] = useState<RateCheckResult | null>(null);

  const targets = useMemo(() => estimateAllMileTargets(QUICK_ESTIMATE_PROFILE)!, []);

  const canCalculate = Number(offer) > 0 && Number(loaded) > 0;

  const calculate = () => {
    track('rate_check_started', { cost_mode: useActualCosts ? 'actual' : 'quick' });
    const r = analyzeRateCheck({
      offeredPay: Number(offer),
      loadedMiles: Number(loaded),
      deadheadMiles: Number(deadhead) || 0,
      breakEvenAllMileRpm: targets.breakEvenAllMileRpm,
      targetAllMileRpm: targets.targetAllMileRpm,
      variableCostPerMile: QUICK_ESTIMATE_PROFILE.variableCostPerMile,
    });
    setResult(r);
    track('rate_check_completed', { verdict: r.verdict });
    track('first_profit_verdict_viewed', { verdict: r.verdict });
  };

  if (result) {
    return (
      <ProfitResult
        result={result}
        offer={Number(offer)}
        breakEven={targets.breakEvenAllMileRpm}
        target={targets.targetAllMileRpm}
        onAdjust={() => setResult(null)}
      />
    );
  }

  return (
    <OnboardingShell step={4} steps={5}>
      <Pill label="Rate Check" tone="green" />
      <Text style={styles.title}>Let’s see what the load pays.</Text>
      <Text style={styles.body}>
        Enter the offer and miles. Deadhead is where good rates go bad.
      </Text>

      <Card label="The load" style={styles.formCard}>
        <NumberField label="Offer amount ($)" value={offer} onChange={setOffer} />
        <NumberField label="Loaded miles" value={loaded} onChange={setLoaded} />
        <NumberField label="Deadhead miles" value={deadhead} onChange={setDeadhead} last />
      </Card>

      <View style={styles.segment}>
        {(
          [
            ['quick', 'Quick Estimate'],
            ['actual', 'Use My Costs'],
          ] as const
        ).map(([key, label]) => {
          const active = (key === 'actual') === useActualCosts;
          return (
            <Pressable
              key={key}
              onPress={() => setUseActualCosts(key === 'actual')}
              style={[styles.segmentItem, active && styles.segmentItemActive]}
            >
              <Text style={[styles.segmentLabel, active && styles.segmentLabelActive]}>
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={styles.costNote}>
        {useActualCosts
          ? 'Full cost setup opens after onboarding. For now we use a starting estimate.'
          : 'We’ll use a starting estimate. Add your real truck costs later for a sharper result.'}
      </Text>

      <View style={styles.footerInline}>
        <Button label="Calculate the Load" disabled={!canCalculate} onPress={calculate} />
      </View>
    </OnboardingShell>
  );
}

function ProfitResult({
  result,
  offer,
  breakEven,
  target,
  onAdjust,
}: {
  result: RateCheckResult;
  offer: number;
  breakEven: number;
  target: number;
  onAdjust: () => void;
}) {
  const router = useRouter();
  const completeFirstAction = useOnboardingStore((s) => s.completeFirstAction);
  const setCardSource = useRateCardStore((s) => s.setSource);
  const verdict = VERDICT_COPY[result.verdict];
  const showRateCard = isFeatureEnabled('rate_sharing_cards_enabled');

  const targetGapUsd = Math.round((target - result.allMileRpm) * result.totalMiles);

  const save = () => {
    completeFirstAction();
    track('first_load_saved', { verdict: result.verdict });
    router.push('/(onboarding)/reveal');
  };

  const createRateCard = () => {
    // Onboarding's Rate Check doesn't collect a lane, so use a sample lane for
    // the demo card; a saved Load supplies the real lane later.
    setCardSource({
      originMetro: 'Chicago',
      originState: 'IL',
      destinationMetro: 'Atlanta',
      destinationState: 'GA',
      equipmentType: 'dry_van',
      rateStatus: 'completed',
      verificationLevel: 'completed_load',
      grossRate: offer,
      loadedRpm: result.loadedRpm,
      allMileRpm: result.allMileRpm,
      loadDate: new Date().toISOString().slice(0, 10),
    });
    track('rate_card_created', { source: 'rate_check' });
    router.push('/rate-card');
  };

  return (
    <OnboardingShell step={4} steps={5}>
      <Pill label={verdict.label} tone={verdict.tone} />
      <Text style={styles.title}>
        {result.verdict === 'below_break_even'
          ? 'This one loses money.'
          : result.verdict === 'below_target'
            ? 'Strong loaded rate — deadhead pulls it under target.'
            : 'This load clears your target.'}
      </Text>
      <Text style={styles.body}>
        {targetGapUsd > 0
          ? `Above break-even, but about $${targetGapUsd} below your profit target once every mile is counted.`
          : 'The effective all-mile rate covers your costs and target.'}
      </Text>

      <Card dark label="Result" labelRight="all-mile basis" style={styles.resultCard}>
        <View style={styles.metricGrid}>
          <ResultMetric label="Offer" value={`$${offer.toLocaleString()}`} />
          <ResultMetric label="Loaded RPM" value={`$${result.loadedRpm.toFixed(2)}`} />
          <ResultMetric label="All-Mile RPM" value={`$${result.allMileRpm.toFixed(2)}`} />
          <ResultMetric label="Break-Even" value={`$${breakEven.toFixed(2)}`} />
          <ResultMetric label="Target" value={`$${target.toFixed(2)}`} />
          <ResultMetric
            label="Contribution"
            value={result.contributionUsd !== null ? `$${Math.round(result.contributionUsd)}` : '—'}
          />
        </View>
      </Card>

      <View style={styles.footerInline}>
        <Button label="Save This Load" onPress={save} />
        {showRateCard && (
          <Button label="Create Rate Card" variant="secondary" onPress={createRateCard} />
        )}
        <Button label="Adjust Costs" variant="secondary" onPress={onAdjust} />
      </View>
    </OnboardingShell>
  );
}

// ---------------------------------------------------------------------------
// Scan Rate Confirmation (Section 31)
// ---------------------------------------------------------------------------

function RateConBranch() {
  const router = useRouter();
  const completeFirstAction = useOnboardingStore((s) => s.completeFirstAction);
  const [scanned, setScanned] = useState<ReturnType<typeof parseRateCon> | null>(null);

  const useSample = () => {
    track('rate_con_scan_started', { source: 'sample' });
    const parsed = parseRateCon(RATE_CON_FIXTURES.standard);
    setScanned(parsed);
    track('rate_con_scan_completed', {});
  };

  const analyze = () => {
    completeFirstAction();
    track('first_load_saved', { source: 'rate_con' });
    router.push('/(onboarding)/reveal');
  };

  if (!scanned) {
    return (
      <OnboardingShell step={4} steps={5}>
        <Pill label="Rate Con" tone="blue" />
        <Text style={styles.title}>Scan the rate con. We’ll build the load.</Text>
        <Text style={styles.body}>
          RigReceipts extracts the route, rate, miles, and terms. You review everything before it is
          saved. The camera opens only when you scan.
        </Text>
        <View style={styles.footerInline}>
          <Button label="Use a Sample Rate Con" onPress={useSample} />
        </View>
        <Text style={styles.costNote}>
          Live capture uses the Scan tab’s on-device OCR after onboarding.
        </Text>
      </OnboardingShell>
    );
  }

  return (
    <OnboardingShell step={4} steps={5}>
      <Pill label="Review" tone="amber" />
      <Text style={styles.title}>Check the details before we calculate the load.</Text>
      <Card dark label="Extracted" labelRight="Rate confirmation" style={styles.resultCard}>
        <ReviewLine label="Broker" value={scanned.broker} />
        <ReviewLine label="Load #" value={scanned.loadNumber} />
        <ReviewLine
          label="Route"
          value={
            scanned.originCity
              ? `${scanned.originCity}, ${scanned.originState} → ${scanned.destinationCity}, ${scanned.destinationState}`
              : null
          }
        />
        <ReviewLine
          label="Offer"
          value={scanned.offerUsd ? `$${scanned.offerUsd.toLocaleString()}` : null}
        />
        <ReviewLine
          label="Loaded miles"
          value={scanned.loadedMiles ? String(scanned.loadedMiles) : null}
          last
        />
      </Card>
      <View style={styles.footerInline}>
        <Button label="Analyze This Load" onPress={analyze} />
      </View>
    </OnboardingShell>
  );
}

// ---------------------------------------------------------------------------
// Community rates (Section 32) — lightweight preview
// ---------------------------------------------------------------------------

function CommunityBranch() {
  const router = useRouter();
  const completeFirstAction = useOnboardingStore((s) => s.completeFirstAction);

  const done = () => {
    completeFirstAction();
    router.push('/(onboarding)/reveal');
  };

  return (
    <OnboardingShell step={4} steps={5}>
      <Pill label="Community Rates" tone="blue" />
      <Text style={styles.title}>Recent driver-shared rates.</Text>
      <Text style={styles.body}>
        Historical rate information by lane and equipment — not available loads. Compare any lane to
        your own costs once your numbers are set.
      </Text>
      <Card label="Chicago, IL → Atlanta, GA" labelRight="Dry Van" style={styles.formCard}>
        <View style={styles.metricGrid}>
          <ResultMetric label="Median All-Mile" value="$2.63" light />
          <ResultMetric label="Range" value="$2.4–2.9" light />
          <ResultMetric label="Verified" value="12 posts" light />
        </View>
      </Card>
      <View style={styles.footerInline}>
        <Button
          label="Save This Lane"
          onPress={() => {
            track('lane_saved', { source: 'onboarding' });
            done();
          }}
        />
        <Button label="Continue" variant="secondary" onPress={done} />
      </View>
    </OnboardingShell>
  );
}

// ---------------------------------------------------------------------------
// Receipt / miles / load success (Sections 33–34)
// ---------------------------------------------------------------------------

function SuccessBranch({ kind }: { kind: 'receipt' | 'miles' | 'load' }) {
  const router = useRouter();
  const completeFirstAction = useOnboardingStore((s) => s.completeFirstAction);
  const [done, setDone] = useState(false);

  const copy = {
    receipt: {
      action: 'Save a Sample Receipt',
      title: 'Receipt saved.',
      body: 'Better expense records make every future Rate Check more accurate.',
    },
    miles: {
      action: 'Record Sample Miles',
      title: 'Miles recorded.',
      body: 'RigReceipts can now show the gap between loaded RPM and what you actually earn across every mile.',
    },
    load: {
      action: 'Create a Sample Load',
      title: 'Load started.',
      body: 'Keep the rate confirmation, receipts, and trip details together in one packet.',
    },
  }[kind];

  const finish = () => {
    completeFirstAction();
    router.push('/(onboarding)/reveal');
  };

  return (
    <OnboardingShell step={4} steps={5}>
      {!done ? (
        <>
          <Pill label="Field Capture" tone="green" />
          <Text style={styles.title}>{copy.action.replace('Sample ', '')}</Text>
          <Text style={styles.body}>
            Real capture uses the tabs after onboarding. For now, add a sample to see your Road
            Board.
          </Text>
          <View style={styles.footerInline}>
            <Button label={copy.action} onPress={() => setDone(true)} />
          </View>
        </>
      ) : (
        <>
          <Pill label="Saved" tone="green" />
          <Text style={styles.title}>{copy.title}</Text>
          <Text style={styles.body}>{copy.body}</Text>
          <View style={styles.footerInline}>
            <Button label="See My Road Board" onPress={finish} />
          </View>
        </>
      )}
    </OnboardingShell>
  );
}

// ---------------------------------------------------------------------------
// Small pieces
// ---------------------------------------------------------------------------

function NumberField({
  label,
  value,
  onChange,
  last,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  last?: boolean;
}) {
  return (
    <View style={[styles.field, last && styles.fieldLast]}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={(v) => onChange(v.replace(/[^0-9.]/g, ''))}
        keyboardType="decimal-pad"
        style={styles.fieldInput}
        placeholder="0"
        placeholderTextColor="rgba(30,35,39,0.3)"
      />
    </View>
  );
}

function ResultMetric({ label, value, light }: { label: string; value: string; light?: boolean }) {
  return (
    <View style={styles.metric}>
      <Text style={[styles.metricLabel, light && styles.metricLabelLight]}>{label}</Text>
      <Text style={[styles.metricValue, light && styles.metricValueLight]}>{value}</Text>
    </View>
  );
}

function ReviewLine({
  label,
  value,
  last,
}: {
  label: string;
  value: string | null;
  last?: boolean;
}) {
  return (
    <View style={[styles.reviewLine, last && styles.fieldLast]}>
      <Text style={styles.reviewLabel}>{label}</Text>
      <Text style={styles.reviewValue}>{value ?? '—'}</Text>
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
    gap: spacing.sm + 2,
    marginTop: spacing.xl,
  },
  formCard: {
    marginTop: spacing.xl,
  },
  resultCard: {
    marginTop: spacing.lg,
  },
  costNote: {
    ...type.bodySmall,
    color: colors.textMuted,
    marginTop: spacing.md,
  },
  // segment
  segment: {
    backgroundColor: 'rgba(30, 35, 39, 0.06)',
    borderRadius: radii.sm + 2,
    flexDirection: 'row',
    marginTop: spacing.lg,
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
  // fields
  field: {
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    paddingVertical: spacing.md,
  },
  fieldLast: {
    borderBottomWidth: 0,
  },
  fieldLabel: {
    ...type.labelTiny,
    color: colors.textMuted,
    marginBottom: 6,
  },
  fieldInput: {
    color: colors.text,
    fontFamily: type.emphasis.fontFamily,
    fontSize: 16,
    padding: 0,
  },
  // metrics
  metricGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  metric: {
    paddingVertical: spacing.sm,
    width: '33.3%',
  },
  metricLabel: {
    ...type.labelTiny,
    color: 'rgba(244, 241, 232, 0.55)',
    marginBottom: 4,
  },
  metricLabelLight: {
    color: colors.textMuted,
  },
  metricValue: {
    ...type.metricSm,
    color: colors.textOnDark,
  },
  metricValueLight: {
    color: colors.text,
  },
  // review lines
  reviewLine: {
    borderBottomColor: 'rgba(244, 241, 232, 0.12)',
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
  },
  reviewLabel: {
    ...type.labelTiny,
    color: 'rgba(244, 241, 232, 0.55)',
  },
  reviewValue: {
    ...type.emphasis,
    color: colors.textOnDark,
    flex: 1,
    textAlign: 'right',
  },
});
