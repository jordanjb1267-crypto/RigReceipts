import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { track } from '@/analytics';
import { Button, Pill } from '@/components';
import { isFeatureEnabled } from '@/config/flags';
import {
  ACCOUNTING_LABELS,
  activeSegment,
  ClassificationChoice,
  effectiveMiles,
  loadMileage,
  NEXT_CHOICES,
  START_CHOICES,
  summarizeSegments,
  unclassifiedMiles,
} from '@/domain';
import {
  startForegroundTracking,
  stopForegroundTracking,
  TrackingStartReason,
} from '@/location/mileageTracker';
import { useLoadsStore } from '@/store/loads';
import { useMileageStore } from '@/store/mileage';
import { colors, palette, radii, spacing, type } from '@/theme';

const mi = (n: number) => `${n.toLocaleString(undefined, { maximumFractionDigits: 1 })} mi`;

const startOfToday = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};

type Pending = { mode: 'start' | 'next'; choice: ClassificationChoice } | null;

/** Live Mileage Core (live_mileage_core_enabled): driver-confirmed session tracking. */
export default function LiveMileageScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const enabled = isFeatureEnabled('live_mileage_core_enabled');

  const segments = useMileageStore((s) => s.segments);
  const activeSessionId = useMileageStore((s) => s.activeSessionId);
  const startTracking = useMileageStore((s) => s.startTracking);
  const beginSegment = useMileageStore((s) => s.beginSegment);
  const imLoaded = useMileageStore((s) => s.imLoaded);
  const markDelivered = useMileageStore((s) => s.markDelivered);
  const appendMiles = useMileageStore((s) => s.appendMiles);
  const stopSession = useMileageStore((s) => s.stopSession);

  const loads = useLoadsStore((s) => s.loads);
  const setLoadStatus = useLoadsStore((s) => s.setStatus);

  const [menu, setMenu] = useState<'start' | 'next' | 'load' | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [milesText, setMilesText] = useState('');
  const [gpsStatus, setGpsStatus] = useState<TrackingStartReason | 'idle'>('idle');

  // GPS foreground distance runs only while a session is active — permission is
  // requested at that moment, never before. On a full app build this measures
  // miles automatically; in Expo Go / web the native module is absent and the
  // manual "Add miles" entry below stays the way in. Background tracking is a
  // separate flag and is not started here.
  useEffect(() => {
    if (!enabled || !activeSessionId) return;
    let cancelled = false;
    startForegroundTracking().then((r) => {
      if (!cancelled) setGpsStatus(r.reason);
    });
    return () => {
      cancelled = true;
      setGpsStatus('idle');
      stopForegroundTracking();
    };
  }, [enabled, activeSessionId]);

  const active = activeSegment(segments);
  const today = useMemo(() => {
    const start = startOfToday();
    return summarizeSegments(segments.filter((s) => s.startedAt >= start));
  }, [segments]);
  const needsReview = unclassifiedMiles(segments);
  const activeLoad = active?.loadId ? loads.find((l) => l.id === active.loadId) : null;
  const activeLoadMiles = active?.loadId ? loadMileage(segments, active.loadId) : null;

  const dispatchChoice = (
    mode: 'start' | 'next',
    choice: ClassificationChoice,
    loadId?: string,
  ) => {
    if (mode === 'start') {
      startTracking(choice, { loadId });
      track('mileage_session_started', { category: choice.category });
    } else {
      beginSegment(choice, { loadId });
    }
    setMenu(null);
    setPending(null);
  };

  const pickChoice = (mode: 'start' | 'next', choice: ClassificationChoice) => {
    if (choice.needsLoad) {
      setPending({ mode, choice });
      setMenu('load');
    } else {
      dispatchChoice(mode, choice);
    }
  };

  const confirmLoaded = () => {
    imLoaded();
    if (active?.loadId) setLoadStatus(active.loadId, 'in_transit');
    track('mileage_loaded_confirmed');
  };

  const confirmDelivered = () => {
    if (active?.loadId) setLoadStatus(active.loadId, 'delivered');
    markDelivered();
    track('mileage_delivered_confirmed');
    setMenu('next');
  };

  const confirmStop = () => {
    stopSession();
    track('mileage_session_stopped');
  };

  const addMiles = () => {
    const n = Number(milesText.replace(/[^0-9.]/g, ''));
    if (n > 0) appendMiles(n);
    setMilesText('');
  };

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <View style={styles.headerRow}>
          <Text style={styles.kicker}>Mileage Ledger</Text>
          <Pressable
            accessibilityLabel="Close"
            onPress={() => router.back()}
            style={styles.closeBtn}
          >
            <Text style={styles.closeText}>✕</Text>
          </Pressable>
        </View>
        <Text style={styles.title}>Live Mileage</Text>
      </View>

      <ScrollView
        contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + spacing.xxl }]}
        keyboardShouldPersistTaps="handled"
      >
        {!enabled ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Live Mileage is in beta.</Text>
            <Text style={styles.copy}>Track a load from deadhead to delivery here soon.</Text>
          </View>
        ) : menu === 'start' || menu === 'next' ? (
          <ChoiceMenu
            title={menu === 'start' ? "What's the truck doing now?" : "What's next?"}
            choices={menu === 'start' ? START_CHOICES : NEXT_CHOICES}
            onPick={(c) => pickChoice(menu, c)}
            onCancel={() => setMenu(null)}
          />
        ) : menu === 'load' && pending ? (
          <LoadPicker
            loads={loads}
            onPick={(id) => dispatchChoice(pending.mode, pending.choice, id)}
            onCreate={() => router.push('/add-load')}
            onCancel={() => setMenu(null)}
          />
        ) : !activeSessionId || !active ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Ready to track</Text>
            <Text style={styles.copy}>
              Start a session and tell RigReceipts what the truck is doing. You stay in control of
              every status change.
            </Text>
            <View style={{ marginTop: spacing.md }}>
              <Button label="Start Tracking" onPress={() => setMenu('start')} />
            </View>
            {needsReview > 0 && (
              <Pressable onPress={() => router.push('/mileage-review')} style={styles.reviewLink}>
                <Text style={styles.reviewText}>{mi(needsReview)} need review →</Text>
              </Pressable>
            )}
          </View>
        ) : (
          <>
            <View style={[styles.card, styles.liveCard]}>
              <View style={styles.liveHead}>
                <Pill
                  label={ACCOUNTING_LABELS[active.accountingCategory]}
                  tone={toneFor(active.accountingCategory)}
                />
                {activeLoad && <Text style={styles.liveLoad}>Load {activeLoad.loadNumber}</Text>}
              </View>
              <Text style={styles.segMiles}>{mi(effectiveMiles(active))}</Text>
              <Text style={styles.segLabel}>Current segment</Text>

              {(() => {
                const hint = gpsHint(gpsStatus);
                return hint ? (
                  <Text style={[styles.gpsHint, { color: hint.color }]}>{hint.text}</Text>
                ) : null;
              })()}

              <View style={styles.statRow}>
                <Stat label="Today" value={mi(today.total)} />
                {activeLoadMiles && (
                  <Stat label="Load total" value={mi(activeLoadMiles.totalMiles)} />
                )}
                {active.accountingCategory === 'loaded' && activeLoadMiles ? (
                  <Stat label="Loaded" value={mi(activeLoadMiles.loadedMiles)} />
                ) : (
                  <Stat label="Deadhead" value={mi(today.deadhead)} />
                )}
              </View>

              <View style={styles.milesEntry}>
                <TextInput
                  value={milesText}
                  onChangeText={(v) => setMilesText(v.replace(/[^0-9.]/g, ''))}
                  keyboardType="decimal-pad"
                  placeholder="Add miles to this segment"
                  placeholderTextColor="rgba(30,35,39,0.3)"
                  style={styles.milesInput}
                  accessibilityLabel="Add miles to this segment"
                />
                <Button label="Add" variant="secondary" disabled={!milesText} onPress={addMiles} />
              </View>
            </View>

            <View style={styles.actions}>
              {active.accountingCategory === 'deadhead' && (
                <Button label="I'm Loaded" onPress={confirmLoaded} />
              )}
              {active.accountingCategory === 'loaded' && (
                <Button label="Mark Delivered" onPress={confirmDelivered} />
              )}
              <Button label="Change Status" variant="secondary" onPress={() => setMenu('start')} />
              {activeLoad && (
                <Button
                  label="View Load"
                  variant="secondary"
                  onPress={() =>
                    router.push({ pathname: '/load-detail', params: { id: activeLoad.id } })
                  }
                />
              )}
              <Button label="Stop Tracking" variant="danger" onPress={confirmStop} />
            </View>

            <Pressable onPress={() => router.push('/mileage-review')} style={styles.timelineLink}>
              <Text style={styles.reviewText}>
                View today&apos;s timeline{needsReview > 0 ? ` · ${mi(needsReview)} to review` : ''}{' '}
                →
              </Text>
            </Pressable>
          </>
        )}
      </ScrollView>
    </View>
  );
}

function ChoiceMenu({
  title,
  choices,
  onPick,
  onCancel,
}: {
  title: string;
  choices: readonly ClassificationChoice[];
  onPick: (c: ClassificationChoice) => void;
  onCancel: () => void;
}) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{title}</Text>
      {choices.map((c) => (
        <Pressable key={c.key} onPress={() => onPick(c)} style={styles.choiceRow}>
          <Text style={styles.choiceLabel}>{c.label}</Text>
          <Text style={styles.choiceArrow}>›</Text>
        </Pressable>
      ))}
      <View style={{ marginTop: spacing.md }}>
        <Button label="Cancel" variant="secondary" onPress={onCancel} />
      </View>
    </View>
  );
}

function LoadPicker({
  loads,
  onPick,
  onCreate,
  onCancel,
}: {
  loads: { id: string; loadNumber: string; origin: string | null; destination: string | null }[];
  onPick: (id: string) => void;
  onCreate: () => void;
  onCancel: () => void;
}) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Which load?</Text>
      {loads.length === 0 ? (
        <Text style={styles.copy}>No loads yet. Create one to track its miles.</Text>
      ) : (
        loads.map((l) => (
          <Pressable key={l.id} onPress={() => onPick(l.id)} style={styles.choiceRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.choiceLabel}>Load {l.loadNumber}</Text>
              {(l.origin || l.destination) && (
                <Text style={styles.choiceSub}>
                  {l.origin ?? '—'} → {l.destination ?? '—'}
                </Text>
              )}
            </View>
            <Text style={styles.choiceArrow}>›</Text>
          </Pressable>
        ))
      )}
      <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
        <Button label="Create New Load" variant="secondary" onPress={onCreate} />
        <Button label="Cancel" variant="secondary" onPress={onCancel} />
      </View>
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

/** Honest, user-facing line about whether GPS is measuring miles automatically. */
function gpsHint(status: TrackingStartReason | 'idle'): { text: string; color: string } | null {
  switch (status) {
    case 'started':
      return { text: '● GPS is measuring this segment', color: palette.routeGreen };
    case 'permission_denied':
      return { text: 'Location is off — add miles by hand below.', color: colors.textMuted };
    case 'module_unavailable':
      return {
        text: 'Auto-tracking runs in the installed app — add miles by hand below.',
        color: colors.textMuted,
      };
    default:
      return null;
  }
}

function toneFor(category: string) {
  switch (category) {
    case 'loaded':
      return 'green' as const;
    case 'deadhead':
      return 'amber' as const;
    case 'business_empty':
      return 'blue' as const;
    case 'personal':
      return 'neutral' as const;
    default:
      return 'rust' as const;
  }
}

const styles = StyleSheet.create({
  root: { backgroundColor: colors.background, flex: 1 },
  header: { paddingHorizontal: spacing.xl },
  headerRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
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
  body: { paddingHorizontal: spacing.xl, paddingTop: spacing.lg },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    marginBottom: spacing.md,
    padding: spacing.lg,
  },
  liveCard: { backgroundColor: colors.surface },
  cardTitle: { ...type.h2, color: colors.text, marginBottom: spacing.md },
  copy: { ...type.body, color: colors.textMuted },
  liveHead: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  liveLoad: { ...type.emphasis, color: colors.text },
  segMiles: {
    color: colors.text,
    fontFamily: type.metricLg.fontFamily,
    fontSize: 40,
    fontVariant: ['tabular-nums'],
    letterSpacing: -1.5,
    marginTop: spacing.md,
  },
  segLabel: { ...type.labelTiny, color: colors.textMuted },
  gpsHint: { ...type.bodySmall, marginTop: spacing.sm },
  statRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },
  stat: { flex: 1 },
  statLabel: { ...type.labelTiny, color: colors.textMuted },
  statValue: {
    color: colors.text,
    fontFamily: type.metricSm.fontFamily,
    fontSize: 17,
    fontVariant: ['tabular-nums'],
    marginTop: 2,
  },
  milesEntry: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  milesInput: {
    ...type.body,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    color: colors.text,
    flex: 1,
    paddingVertical: spacing.sm,
  },
  actions: { gap: spacing.sm },
  choiceRow: {
    alignItems: 'center',
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: 'row',
    paddingVertical: spacing.md,
  },
  choiceLabel: { ...type.body, color: colors.text, flex: 1 },
  choiceSub: { ...type.bodySmall, color: colors.textMuted, marginTop: 2 },
  choiceArrow: { ...type.h2, color: colors.textMuted },
  reviewLink: { marginTop: spacing.md },
  timelineLink: { marginTop: spacing.md, paddingVertical: spacing.sm },
  reviewText: { ...type.emphasis, color: palette.highwayBlue },
});
