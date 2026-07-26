import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components';
import { useTripsStore } from '@/store/trips';
import { colors, palette, radii, spacing, type } from '@/theme';

const todayIso = () => new Date().toISOString().slice(0, 10);
const toMiles = (v: string): number => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
};

/** Manual trip entry — loaded + deadhead miles for one run. */
export default function AddTripScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const addTrip = useTripsStore((s) => s.addTrip);

  const [date, setDate] = useState(todayIso());
  const [loaded, setLoaded] = useState('');
  const [deadhead, setDeadhead] = useState('');
  const [note, setNote] = useState('');

  const loadedMiles = toMiles(loaded);
  const deadheadMiles = toMiles(deadhead);
  const total = loadedMiles + deadheadMiles;
  const canSave = total > 0 && /^\d{4}-\d{2}-\d{2}$/.test(date);

  const save = () => {
    if (!canSave) return;
    addTrip({ date, loadedMiles, deadheadMiles, note: note.trim() || null });
    router.back();
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
        <Text style={styles.title}>Add a trip</Text>
        <Text style={styles.subtitle}>Loaded and deadhead miles for one run.</Text>
      </View>

      <ScrollView
        contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + spacing.xxl }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.card}>
          <Field label="Date">
            <TextInput
              value={date}
              onChangeText={setDate}
              placeholder="YYYY-MM-DD"
              placeholderTextColor="rgba(244,241,232,0.3)"
              style={styles.input}
              accessibilityLabel="Trip date"
            />
          </Field>
          <Field label="Loaded miles" hint="Miles under a paying load.">
            <TextInput
              value={loaded}
              onChangeText={(v) => setLoaded(v.replace(/[^0-9]/g, ''))}
              keyboardType="number-pad"
              placeholder="0"
              placeholderTextColor="rgba(244,241,232,0.3)"
              style={styles.input}
              accessibilityLabel="Loaded miles"
            />
          </Field>
          <Field label="Deadhead miles" hint="Empty miles to the next pickup.">
            <TextInput
              value={deadhead}
              onChangeText={(v) => setDeadhead(v.replace(/[^0-9]/g, ''))}
              keyboardType="number-pad"
              placeholder="0"
              placeholderTextColor="rgba(244,241,232,0.3)"
              style={styles.input}
              accessibilityLabel="Deadhead miles"
            />
          </Field>
          <Field label="Note (optional)">
            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder="Lane, load number…"
              placeholderTextColor="rgba(244,241,232,0.3)"
              style={styles.input}
              accessibilityLabel="Trip note"
            />
          </Field>

          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Total miles</Text>
            <Text style={styles.totalValue}>{total.toLocaleString()}</Text>
          </View>
        </View>

        <Button label="Save trip" disabled={!canSave} onPress={save} />
      </ScrollView>
    </View>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {hint && <Text style={styles.fieldHint}>{hint}</Text>}
      {children}
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
  subtitle: { ...type.body, color: colors.textMuted, marginTop: spacing.xs },
  body: { paddingHorizontal: spacing.xl, paddingTop: spacing.lg },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    marginBottom: spacing.md,
    padding: spacing.lg,
  },
  field: { marginBottom: spacing.md },
  fieldLabel: { ...type.emphasis, color: colors.text },
  fieldHint: { ...type.bodySmall, color: colors.textMuted, marginBottom: 4, marginTop: 2 },
  input: {
    ...type.body,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    color: colors.text,
    marginTop: 4,
    paddingVertical: spacing.sm,
  },
  totalRow: {
    alignItems: 'baseline',
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
    paddingTop: spacing.md,
  },
  totalLabel: { ...type.labelTiny, color: colors.textMuted },
  totalValue: {
    color: palette.routeGreen,
    fontFamily: type.metricSm.fontFamily,
    fontSize: 22,
    fontVariant: ['tabular-nums'],
  },
});
