import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Pill } from '@/components';
import { isFeatureEnabled } from '@/config/flags';
import { BrokerReliability, RELIABILITY_LABEL, summarizeBrokerHistory } from '@/domain';
import { useBrokerWatchStore } from '@/store/brokerWatch';
import { colors, palette, radii, spacing, Tone, type } from '@/theme';

const TONE: Record<BrokerReliability, Tone> = {
  excellent: 'green',
  good: 'blue',
  watch: 'amber',
  unrated: 'neutral',
};

/** Broker Check (broker_check_enabled): the driver's private pay-reliability log. */
export default function BrokerCheckScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const enabled = isFeatureEnabled('broker_check_enabled');

  const brokers = useBrokerWatchStore((s) => s.brokers);
  const addBroker = useBrokerWatchStore((s) => s.addBroker);
  const logExperience = useBrokerWatchStore((s) => s.logExperience);
  const removeBroker = useBrokerWatchStore((s) => s.removeBroker);

  const [name, setName] = useState('');
  const [mc, setMc] = useState('');
  const [logFor, setLogFor] = useState<string | null>(null);
  const [onTime, setOnTime] = useState(true);
  const [days, setDays] = useState('');

  const submitBroker = () => {
    if (!name.trim()) return;
    addBroker(name, mc);
    setName('');
    setMc('');
  };

  const submitLog = () => {
    if (!logFor) return;
    logExperience(logFor, {
      loadDate: new Date().toISOString().slice(0, 10),
      paidOnTime: onTime,
      daysToPay: days ? Number(days) : null,
      detentionHonored: null,
    });
    setLogFor(null);
    setOnTime(true);
    setDays('');
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
        <Text style={styles.title}>Broker Check</Text>
        <View style={styles.clarify}>
          <Text style={styles.clarifyText}>
            Based only on your own records — not a public rating or credit report.
          </Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + spacing.xxl }]}
        keyboardShouldPersistTaps="handled"
      >
        {!enabled ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Broker Check is in beta.</Text>
            <Text style={styles.cardCopy}>Track how brokers pay you here soon.</Text>
          </View>
        ) : (
          <>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Track a broker</Text>
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder="Broker name"
                placeholderTextColor="rgba(244,241,232,0.3)"
                style={styles.input}
                accessibilityLabel="Broker name"
              />
              <TextInput
                value={mc}
                onChangeText={setMc}
                placeholder="MC number (optional)"
                placeholderTextColor="rgba(244,241,232,0.3)"
                keyboardType="number-pad"
                style={[styles.input, styles.inputLast]}
                accessibilityLabel="MC number"
              />
              <Button label="Add to Watchlist" disabled={!name.trim()} onPress={submitBroker} />
            </View>

            {brokers.length === 0 ? (
              <Text style={styles.empty}>
                No brokers yet. Add one, then log how each load paid to build your own history.
              </Text>
            ) : (
              brokers.map((b) => {
                const s = summarizeBrokerHistory(b.experiences);
                return (
                  <View key={b.id} style={styles.card}>
                    <View style={styles.brokerHead}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.brokerName}>{b.name}</Text>
                        {b.mcNumber && <Text style={styles.brokerMc}>MC {b.mcNumber}</Text>}
                      </View>
                      <Pill label={RELIABILITY_LABEL[s.reliability]} tone={TONE[s.reliability]} />
                    </View>

                    <View style={styles.stats}>
                      <Stat label="Loads" value={String(s.loadCount)} />
                      <Stat
                        label="Paid on time"
                        value={s.onTimeRate !== null ? `${Math.round(s.onTimeRate * 100)}%` : '—'}
                      />
                      <Stat
                        label="Avg days to pay"
                        value={s.avgDaysToPay !== null ? String(s.avgDaysToPay) : '—'}
                      />
                    </View>

                    {logFor === b.id ? (
                      <View style={styles.logBox}>
                        <View style={styles.logRow}>
                          <Text style={styles.logLabel}>Paid on time</Text>
                          <Switch
                            value={onTime}
                            onValueChange={setOnTime}
                            trackColor={{ true: palette.routeGreen, false: '#c9c5bc' }}
                          />
                        </View>
                        <View style={styles.logRow}>
                          <Text style={styles.logLabel}>Days to pay</Text>
                          <TextInput
                            value={days}
                            onChangeText={(v) => setDays(v.replace(/[^0-9]/g, ''))}
                            keyboardType="number-pad"
                            placeholder="—"
                            placeholderTextColor="rgba(244,241,232,0.3)"
                            style={styles.logInput}
                            accessibilityLabel="Days to pay"
                          />
                        </View>
                        <View style={styles.logActions}>
                          <Button label="Save Load" onPress={submitLog} />
                          <Button
                            label="Cancel"
                            variant="secondary"
                            onPress={() => setLogFor(null)}
                          />
                        </View>
                      </View>
                    ) : (
                      <View style={styles.brokerActions}>
                        <Pressable onPress={() => setLogFor(b.id)}>
                          <Text style={styles.actionLink}>Log a load</Text>
                        </Pressable>
                        <Text style={styles.dot}>·</Text>
                        <Pressable onPress={() => removeBroker(b.id)}>
                          <Text style={styles.actionLink}>Remove</Text>
                        </Pressable>
                      </View>
                    )}
                  </View>
                );
              })
            )}
          </>
        )}
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
  title: { ...type.h1, color: colors.text, marginTop: spacing.sm },
  clarify: {
    backgroundColor: 'rgba(61, 100, 128, 0.1)',
    borderRadius: radii.sm,
    marginTop: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  clarifyText: { ...type.labelTiny, color: palette.highwayBlue, letterSpacing: 0.3 },
  body: { paddingHorizontal: spacing.xl, paddingTop: spacing.lg },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    marginBottom: spacing.md,
    padding: spacing.lg,
  },
  cardTitle: { ...type.h2, color: colors.text, marginBottom: spacing.md },
  cardCopy: { ...type.body, color: colors.textMuted },
  input: {
    ...type.body,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    color: colors.text,
    marginBottom: spacing.md,
    paddingVertical: spacing.sm,
  },
  inputLast: { marginBottom: spacing.lg },
  empty: { ...type.body, color: colors.textMuted, marginTop: spacing.sm, textAlign: 'center' },
  brokerHead: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  brokerName: { ...type.h2, color: colors.text, fontSize: 17 },
  brokerMc: { ...type.labelTiny, color: colors.textMuted, marginTop: 2 },
  stats: { flexDirection: 'row', marginTop: spacing.md },
  stat: { flex: 1 },
  statLabel: { ...type.labelTiny, color: colors.textMuted, marginBottom: 3 },
  statValue: {
    color: colors.text,
    fontFamily: type.metricSm.fontFamily,
    fontSize: 18,
    fontVariant: ['tabular-nums'],
  },
  brokerActions: {
    alignItems: 'center',
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
    paddingTop: spacing.md,
  },
  actionLink: { ...type.emphasis, color: palette.highwayBlue, fontSize: 13 },
  dot: { color: colors.textMuted },
  logBox: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    marginTop: spacing.md,
    paddingTop: spacing.sm,
  },
  logRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
  },
  logLabel: { ...type.body, color: colors.text },
  logInput: {
    ...type.emphasis,
    color: colors.text,
    fontVariant: ['tabular-nums'],
    minWidth: 60,
    textAlign: 'right',
  },
  logActions: { gap: spacing.sm, marginTop: spacing.md },
});
