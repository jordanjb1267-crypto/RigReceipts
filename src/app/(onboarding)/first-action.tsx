import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { track } from '@/analytics';
import { Button, Card, OnboardingShell, Pill } from '@/components';
import { isFeatureEnabled } from '@/config/flags';
import {
  analyzeRateCheck,
  EQUIPMENT_TYPES,
  EquipmentType,
  estimateAllMileTargets,
  QUICK_ESTIMATE_PROFILE,
  RateCheckResult,
} from '@/domain';
import { parseRateCon, RATE_CON_FIXTURES } from '@/ocr';
import { useOnboardingStore } from '@/store/onboarding';
import { useRateCardStore } from '@/store/rateCard';
import { colors, palette, radii, spacing, type } from '@/theme';

/** Optional lane entered under "Add Trip Details" — feeds the Rate Card lane. */
interface TripDetails {
  originCity: string;
  originState: string;
  destinationCity: string;
  destinationState: string;
  equipmentType: EquipmentType;
}

const EMPTY_TRIP: TripDetails = {
  originCity: '',
  originState: '',
  destinationCity: '',
  destinationState: '',
  equipmentType: 'dry_van',
};

/** Progressive labels for the calculation interstitial (Screen 6). */
const CALC_STEPS = [
  'Calculating loaded RPM.',
  'Adding deadhead.',
  'Applying operating costs.',
  'Checking your target.',
];

type VerdictTone = 'good' | 'rust' | 'red';
const VERDICT_COPY: Record<RateCheckResult['verdict'], { label: string; tone: VerdictTone }> = {
  above_target: { label: 'ABOVE TARGET', tone: 'good' },
  on_target: { label: 'ON TARGET', tone: 'good' },
  below_target: { label: 'BELOW TARGET', tone: 'rust' },
  below_break_even: { label: 'BELOW BREAK-EVEN', tone: 'red' },
};

const VERDICT_FILL: Record<VerdictTone, { bg: string; border: string; fg: string }> = {
  good: { bg: 'rgba(46, 107, 87, 0.22)', border: 'rgba(46, 107, 87, 0.45)', fg: palette.goodLight },
  rust: { bg: 'rgba(154, 92, 58, 0.22)', border: 'rgba(154, 92, 58, 0.45)', fg: '#C99A7E' },
  red: { bg: 'rgba(169, 74, 59, 0.22)', border: 'rgba(169, 74, 59, 0.45)', fg: '#C4655A' },
};

const rpm = (n: number) => `$${n.toFixed(2)}`;

/** O5 · First useful action — branches by the job chosen on O4. */
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
// Check My Rate (Screens 5–7)
// ---------------------------------------------------------------------------

type Field = 'offer' | 'loaded' | 'deadhead';

function RateCheckBranch() {
  const [offer, setOffer] = useState('2150');
  const [loaded, setLoaded] = useState('720');
  const [deadhead, setDeadhead] = useState('142');
  const [focused, setFocused] = useState<Field | null>(null);
  const [useActualCosts, setUseActualCosts] = useState(false);
  const [result, setResult] = useState<RateCheckResult | null>(null);
  const [calculating, setCalculating] = useState(false);
  const [tripOpen, setTripOpen] = useState(false);
  const [trip, setTrip] = useState<TripDetails>(EMPTY_TRIP);

  const targets = useMemo(() => estimateAllMileTargets(QUICK_ESTIMATE_PROFILE)!, []);

  const offerN = Number(offer) || 0;
  const loadedN = Number(loaded) || 0;
  const deadheadN = Number(deadhead) || 0;

  const offerError = offerN > 0 ? null : 'Enter the offered rate.';
  const loadedError = loadedN > 0 ? null : 'Loaded miles must be greater than zero.';
  const canCalculate = !offerError && !loadedError;

  // Live preview (README · Rate check) — recomputes on every keystroke.
  const total = loadedN + deadheadN;
  const allMileRpm = canCalculate && total > 0 ? offerN / total : null;
  const delta = allMileRpm !== null ? allMileRpm - targets.targetAllMileRpm : null;
  const meterPct =
    allMileRpm !== null
      ? Math.min(97, Math.max(3, ((allMileRpm - 1.4) / 2.0) * 100))
      : null;

  const calculate = () => {
    if (!canCalculate) return;
    track('rate_check_started', { cost_mode: useActualCosts ? 'actual' : 'quick' });
    setCalculating(true);
  };

  const finishCalculation = () => {
    const r = analyzeRateCheck({
      offeredPay: offerN,
      loadedMiles: loadedN,
      deadheadMiles: deadheadN,
      breakEvenAllMileRpm: targets.breakEvenAllMileRpm,
      targetAllMileRpm: targets.targetAllMileRpm,
      variableCostPerMile: QUICK_ESTIMATE_PROFILE.variableCostPerMile,
    });
    setCalculating(false);
    setResult(r);
    track('rate_check_completed', { verdict: r.verdict });
    track('first_profit_verdict_viewed', { verdict: r.verdict });
  };

  if (calculating) return <RateCheckLoading onDone={finishCalculation} />;

  if (result) {
    return (
      <ProfitResult
        result={result}
        offer={offerN}
        breakEven={targets.breakEvenAllMileRpm}
        target={targets.targetAllMileRpm}
        trip={trip.originCity.trim() ? trip : null}
        onAdjust={() => setResult(null)}
      />
    );
  }

  return (
    <OnboardingShell step={4} steps={5}>
      <Pill label="Rate Check" tone="green" />
      <Text style={styles.title}>Let&apos;s see what the load pays.</Text>
      <Text style={styles.body}>Enter the offer and miles. Deadhead is where good rates go bad.</Text>

      <View style={styles.fieldCard}>
        <FieldRow
          label="Offer amount"
          prefix="$"
          value={offer}
          onChange={setOffer}
          focused={focused === 'offer'}
          onFocus={() => setFocused('offer')}
          onBlur={() => setFocused(null)}
          error={offerError}
        />
        <FieldRow
          label="Loaded miles"
          value={loaded}
          onChange={setLoaded}
          focused={focused === 'loaded'}
          onFocus={() => setFocused('loaded')}
          onBlur={() => setFocused(null)}
          error={loadedError}
        />
        <FieldRow
          label="Deadhead miles"
          value={deadhead}
          onChange={setDeadhead}
          focused={focused === 'deadhead'}
          onFocus={() => setFocused('deadhead')}
          onBlur={() => setFocused(null)}
          last
        />
      </View>

      {allMileRpm !== null && delta !== null && meterPct !== null && (
        <View style={styles.preview}>
          <View style={styles.previewTop}>
            <View>
              <Text style={styles.previewLabel}>All-mile RPM</Text>
              <Text style={styles.previewValue}>{rpm(allMileRpm)}</Text>
            </View>
            <Text style={[styles.previewDelta, { color: delta >= 0 ? palette.goodLight : '#C99A7E' }]}>
              {delta >= 0 ? '+' : '−'}
              {rpm(Math.abs(delta))} vs target
            </Text>
          </View>
          <View style={styles.meterTrack}>
            <View style={[styles.meterFill, { width: `${meterPct}%` }]} />
          </View>
        </View>
      )}

      <Pressable
        accessibilityRole="button"
        onPress={() => setTripOpen((v) => !v)}
        style={styles.discloseRow}
      >
        <Text style={styles.discloseLabel}>Add trip details</Text>
        <Text style={styles.discloseChevron}>{tripOpen ? '▲' : '▼'}</Text>
      </Pressable>
      {tripOpen && (
        <Card style={styles.formCard}>
          <View style={styles.tripRow}>
            <TextField
              label="Origin city"
              value={trip.originCity}
              onChange={(v) => setTrip((t) => ({ ...t, originCity: v }))}
              flex={2}
            />
            <TextField
              label="State"
              value={trip.originState}
              onChange={(v) => setTrip((t) => ({ ...t, originState: v.toUpperCase().slice(0, 2) }))}
              flex={1}
            />
          </View>
          <View style={styles.tripRow}>
            <TextField
              label="Destination city"
              value={trip.destinationCity}
              onChange={(v) => setTrip((t) => ({ ...t, destinationCity: v }))}
              flex={2}
            />
            <TextField
              label="State"
              value={trip.destinationState}
              onChange={(v) =>
                setTrip((t) => ({ ...t, destinationState: v.toUpperCase().slice(0, 2) }))
              }
              flex={1}
            />
          </View>
          <Text style={[styles.fieldLabel, { marginTop: spacing.md }]}>Equipment</Text>
          <View style={styles.equipWrap}>
            {EQUIPMENT_TYPES.map((e) => {
              const active = trip.equipmentType === e.slug;
              return (
                <Pressable
                  key={e.slug}
                  onPress={() => setTrip((t) => ({ ...t, equipmentType: e.slug }))}
                  style={[styles.equipChip, active && styles.equipChipActive]}
                >
                  <Text style={[styles.equipChipText, active && styles.equipChipTextActive]}>
                    {e.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={styles.costNote}>
            Optional — a lane makes the Rate Card you can share match this load.
          </Text>
        </Card>
      )}

      <View style={styles.segment}>
        {(
          [
            ['quick', 'Quick estimate'],
            ['actual', 'Use my costs'],
          ] as const
        ).map(([key, label]) => {
          const active = (key === 'actual') === useActualCosts;
          return (
            <Pressable
              key={key}
              onPress={() => setUseActualCosts(key === 'actual')}
              style={[styles.segmentItem, active && styles.segmentItemActive]}
            >
              <Text style={[styles.segmentLabel, active && styles.segmentLabelActive]}>{label}</Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={styles.costNote}>
        {useActualCosts
          ? 'Full cost setup opens after onboarding. For now we use a starting estimate.'
          : 'We&apos;ll use a starting estimate. Add your real truck costs later for a sharper result.'}
      </Text>

      <View style={styles.footerInline}>
        <Button label="Calculate the load" disabled={!canCalculate} onPress={calculate} />
      </View>
    </OnboardingShell>
  );
}

/** Screen 6 — a 4-step progress bar + rotating copy, ~420ms per step. */
function RateCheckLoading({ onDone }: { onDone: () => void }) {
  const [stepIndex, setStepIndex] = useState(0);
  const doneRef = useRef(onDone);
  useEffect(() => {
    doneRef.current = onDone;
  }, [onDone]);

  useEffect(() => {
    let cancelled = false;
    const cleanup: (() => void)[] = [];
    AccessibilityInfo.isReduceMotionEnabled().then((reduce) => {
      if (cancelled) return;
      if (reduce) {
        // Hold the final line, skip the animation, then continue.
        setStepIndex(CALC_STEPS.length - 1);
        const done = setTimeout(() => doneRef.current(), 500);
        cleanup.push(() => clearTimeout(done));
        return;
      }
      const rotate = setInterval(() => {
        setStepIndex((i) => Math.min(i + 1, CALC_STEPS.length - 1));
      }, 420);
      const done = setTimeout(() => {
        clearInterval(rotate);
        doneRef.current();
      }, 420 * CALC_STEPS.length + 60);
      cleanup.push(() => {
        clearInterval(rotate);
        clearTimeout(done);
      });
    });
    return () => {
      cancelled = true;
      cleanup.forEach((fn) => fn());
    };
  }, []);

  const pct = ((stepIndex + 1) / CALC_STEPS.length) * 100;

  return (
    <OnboardingShell step={4} steps={5}>
      <Pill label="Rate Check" tone="green" />
      <View style={styles.loadingBlock}>
        <Text style={styles.loadingTitle}>Running the numbers</Text>
        <View style={styles.loadingMeter}>
          <View style={[styles.loadingFill, { width: `${pct}%` }]} />
        </View>
        <Text style={styles.loadingStep}>{CALC_STEPS[stepIndex]}</Text>
      </View>
    </OnboardingShell>
  );
}

function ProfitResult({
  result,
  offer,
  breakEven,
  target,
  trip,
  onAdjust,
}: {
  result: RateCheckResult;
  offer: number;
  breakEven: number;
  target: number;
  trip: TripDetails | null;
  onAdjust: () => void;
}) {
  const router = useRouter();
  const completeFirstAction = useOnboardingStore((s) => s.completeFirstAction);
  const setCardSource = useRateCardStore((s) => s.setSource);
  const verdict = VERDICT_COPY[result.verdict];
  const fill = VERDICT_FILL[verdict.tone];
  const showRateCard = isFeatureEnabled('rate_sharing_cards_enabled');

  const targetGapUsd = Math.round((target - result.allMileRpm) * result.totalMiles);
  const breakdown = [
    { label: 'Offer', value: `$${offer.toLocaleString()}` },
    { label: 'Loaded RPM', value: rpm(result.loadedRpm) },
    { label: 'All-mile RPM', value: rpm(result.allMileRpm) },
    { label: 'Break-even', value: rpm(breakEven) },
    { label: 'Target', value: rpm(target) },
  ];

  const save = () => {
    completeFirstAction();
    track('first_load_saved', { verdict: result.verdict });
    router.push('/(onboarding)/reveal');
  };

  const createRateCard = () => {
    setCardSource({
      originMetro: trip?.originCity || 'Chicago',
      originState: trip?.originState || 'IL',
      destinationMetro: trip?.destinationCity || 'Atlanta',
      destinationState: trip?.destinationState || 'GA',
      equipmentType: trip?.equipmentType ?? 'dry_van',
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
      <View style={[styles.verdictPill, { backgroundColor: fill.bg, borderColor: fill.border }]}>
        <Text style={[styles.verdictPillText, { color: fill.fg }]}>{verdict.label}</Text>
      </View>
      <Text style={styles.title}>
        {result.verdict === 'below_break_even'
          ? 'This one loses money.'
          : result.verdict === 'below_target'
            ? 'Strong loaded rate — deadhead pulls it under target.'
            : 'This load clears your target.'}
      </Text>

      <Text style={styles.heroLabel}>All-mile RPM</Text>
      <Text style={[styles.hero, { color: fill.fg }]}>{rpm(result.allMileRpm)}</Text>
      <View style={styles.chipRow}>
        <View style={styles.chip}>
          <Text style={styles.chipText}>Loaded {rpm(result.loadedRpm)}</Text>
        </View>
        <View style={styles.chip}>
          <Text style={styles.chipText}>Target {rpm(target)}</Text>
        </View>
      </View>

      <Card dark style={styles.resultCard}>
        {breakdown.map((row, i) => (
          <View key={row.label} style={[styles.breakRow, i === breakdown.length - 1 && styles.last]}>
            <Text style={styles.breakLabel}>{row.label}</Text>
            <Text style={styles.breakValue}>{row.value}</Text>
          </View>
        ))}
      </Card>

      <View style={styles.nudge}>
        <Text style={styles.nudgeLabel}>What would move it</Text>
        <Text style={styles.nudgeCopy}>
          {targetGapUsd > 0
            ? `About $${targetGapUsd} short of target once every mile counts. Trim deadhead or hold out for ~$${Math.round(offer + targetGapUsd).toLocaleString()} to clear it.`
            : 'The effective all-mile rate already covers your costs and target.'}
        </Text>
      </View>

      <View style={styles.footerInline}>
        <Button label="Save this load" onPress={save} />
        {showRateCard && (
          <Button label="Create rate card" variant="secondary" onPress={createRateCard} />
        )}
        <Button label="Adjust costs" variant="secondary" onPress={onAdjust} />
      </View>
    </OnboardingShell>
  );
}

// ---------------------------------------------------------------------------
// Scan Rate Confirmation
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
        <Text style={styles.title}>Scan the rate con. We&apos;ll build the load.</Text>
        <Text style={styles.body}>
          RigReceipts extracts the route, rate, miles, and terms. You review everything before it is
          saved. The camera opens only when you scan.
        </Text>
        <View style={styles.footerInline}>
          <Button label="Use a sample rate con" onPress={useSample} />
        </View>
        <Text style={styles.costNote}>
          Live capture uses the Scan tab&apos;s on-device OCR after onboarding.
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
        <Button label="Analyze this load" onPress={analyze} />
      </View>
    </OnboardingShell>
  );
}

// ---------------------------------------------------------------------------
// Community rates — lightweight preview
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
          <ResultMetric label="Median all-mile" value="$2.63" />
          <ResultMetric label="Range" value="$2.4–2.9" />
          <ResultMetric label="Verified" value="12 posts" />
        </View>
      </Card>
      <View style={styles.footerInline}>
        <Button
          label="Save this lane"
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
// Receipt / miles / load success
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

function FieldRow({
  label,
  value,
  onChange,
  prefix,
  focused,
  onFocus,
  onBlur,
  last,
  error,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  prefix?: string;
  focused: boolean;
  onFocus: () => void;
  onBlur: () => void;
  last?: boolean;
  error?: string | null;
}) {
  return (
    <View style={[styles.fieldRow, last && styles.last, focused && styles.fieldRowFocused]}>
      <Text style={[styles.fieldRowLabel, focused && styles.fieldRowLabelFocused]}>{label}</Text>
      <View style={styles.fieldRowValue}>
        {prefix && <Text style={styles.fieldPrefix}>{prefix}</Text>}
        <TextInput
          value={value}
          onChangeText={(v) => onChange(v.replace(/[^0-9.]/g, ''))}
          onFocus={onFocus}
          onBlur={onBlur}
          keyboardType="decimal-pad"
          style={styles.fieldRowInput}
          placeholder="0"
          placeholderTextColor="rgba(244,241,232,0.3)"
          accessibilityLabel={label}
        />
      </View>
      {error && focused ? <Text style={styles.fieldError}>{error}</Text> : null}
    </View>
  );
}

function TextField({
  label,
  value,
  onChange,
  flex,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  flex: number;
}) {
  return (
    <View style={[styles.field, styles.last, { flex }]}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        autoCapitalize="words"
        style={styles.fieldInput}
        placeholder="—"
        placeholderTextColor="rgba(244,241,232,0.3)"
        accessibilityLabel={label}
      />
    </View>
  );
}

function ResultMetric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
  );
}

function ReviewLine({ label, value, last }: { label: string; value: string | null; last?: boolean }) {
  return (
    <View style={[styles.reviewLine, last && styles.last]}>
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
  last: {
    borderBottomWidth: 0,
  },
  // rate-check fields as rows
  fieldCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.card,
    borderWidth: 1,
    marginTop: spacing.xl,
    paddingHorizontal: spacing.lg,
  },
  fieldRow: {
    borderBottomColor: colors.borderSoft,
    borderBottomWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md + 2,
  },
  fieldRowFocused: {
    borderBottomColor: colors.action,
  },
  fieldRowLabel: {
    ...type.rowTitle,
    color: colors.textMuted,
    flex: 1,
  },
  fieldRowLabelFocused: {
    color: colors.action,
  },
  fieldRowValue: {
    alignItems: 'center',
    flexDirection: 'row',
  },
  fieldPrefix: {
    color: colors.text,
    fontFamily: type.metric.fontFamily,
    fontSize: 22,
    marginRight: 2,
  },
  fieldRowInput: {
    color: colors.text,
    fontFamily: type.metric.fontFamily,
    fontSize: 24,
    fontVariant: ['tabular-nums'],
    letterSpacing: -1,
    minWidth: 90,
    padding: 0,
    textAlign: 'right',
  },
  fieldError: {
    ...type.bodySmall,
    color: '#C4655A',
    width: '100%',
  },
  // live preview
  preview: {
    marginTop: spacing.lg,
  },
  previewTop: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  previewLabel: {
    ...type.labelTiny,
    color: colors.textFaint,
  },
  previewValue: {
    ...type.metric,
    color: colors.text,
    marginTop: 2,
  },
  previewDelta: {
    ...type.emphasis,
    fontVariant: ['tabular-nums'],
  },
  meterTrack: {
    backgroundColor: colors.border,
    borderRadius: radii.pill,
    height: 6,
    overflow: 'hidden',
  },
  meterFill: {
    backgroundColor: colors.action,
    borderRadius: radii.pill,
    height: 6,
  },
  // segment
  segment: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radii.field,
    flexDirection: 'row',
    marginTop: spacing.lg,
    padding: 4,
  },
  segmentItem: {
    alignItems: 'center',
    borderRadius: radii.field - 4,
    flex: 1,
    paddingVertical: 10,
  },
  segmentItemActive: {
    backgroundColor: 'rgba(244, 241, 232, 0.12)',
  },
  segmentLabel: {
    ...type.emphasis,
    color: colors.textMuted,
  },
  segmentLabelActive: {
    color: colors.text,
  },
  // trip fields
  field: {
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    paddingVertical: spacing.md,
  },
  fieldLabel: {
    ...type.labelTiny,
    color: colors.textFaint,
    marginBottom: 6,
  },
  fieldInput: {
    color: colors.text,
    fontFamily: type.emphasis.fontFamily,
    fontSize: 16,
    padding: 0,
  },
  discloseRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.lg,
    paddingVertical: spacing.sm,
  },
  discloseLabel: {
    ...type.emphasis,
    color: colors.text,
  },
  discloseChevron: {
    color: colors.textMuted,
    fontSize: 12,
  },
  tripRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  equipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  equipChip: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: radii.pill,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  equipChipActive: {
    backgroundColor: colors.action,
    borderColor: colors.action,
  },
  equipChipText: {
    ...type.emphasis,
    color: colors.text,
    fontSize: 12,
  },
  equipChipTextActive: {
    color: colors.actionInk,
  },
  // loading interstitial
  loadingBlock: {
    gap: spacing.md,
    paddingVertical: spacing.xxl * 2,
  },
  loadingTitle: {
    ...type.section,
    color: colors.text,
  },
  loadingMeter: {
    backgroundColor: colors.border,
    borderRadius: radii.pill,
    height: 3,
    marginTop: spacing.sm,
    overflow: 'hidden',
  },
  loadingFill: {
    backgroundColor: colors.action,
    borderRadius: radii.pill,
    height: 3,
  },
  loadingStep: {
    ...type.body,
    color: colors.textMuted,
  },
  // verdict hero
  verdictPill: {
    alignSelf: 'flex-start',
    borderRadius: radii.pill,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  verdictPillText: {
    ...type.labelTiny,
  },
  heroLabel: {
    ...type.label,
    color: colors.textFaint,
    marginTop: spacing.lg,
  },
  hero: {
    fontFamily: type.hero.fontFamily,
    fontSize: 74,
    letterSpacing: -4.2,
    lineHeight: 76,
    fontVariant: ['tabular-nums'],
    marginTop: 2,
  },
  chipRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  chip: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: radii.pill,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  chipText: {
    ...type.emphasis,
    color: colors.textMuted,
    fontVariant: ['tabular-nums'],
  },
  // verdict breakdown
  breakRow: {
    borderBottomColor: colors.borderSoft,
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
  },
  breakLabel: {
    ...type.body,
    color: colors.textMuted,
  },
  breakValue: {
    ...type.metricSm,
    color: colors.text,
  },
  nudge: {
    backgroundColor: 'rgba(217, 133, 43, 0.12)',
    borderColor: 'rgba(217, 133, 43, 0.3)',
    borderRadius: radii.card,
    borderWidth: 1,
    marginTop: spacing.md,
    padding: spacing.lg,
  },
  nudgeLabel: {
    ...type.label,
    color: '#D9A44C',
  },
  nudgeCopy: {
    ...type.body,
    color: colors.textMuted,
    marginTop: spacing.xs,
  },
  // metrics (community)
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
    color: colors.textFaint,
    marginBottom: 4,
  },
  metricValue: {
    ...type.metricSm,
    color: colors.text,
  },
  // review lines
  reviewLine: {
    borderBottomColor: colors.borderSoft,
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
  },
  reviewLabel: {
    ...type.labelTiny,
    color: colors.textFaint,
  },
  reviewValue: {
    ...type.emphasis,
    color: colors.text,
    flex: 1,
    textAlign: 'right',
  },
});
