import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components';
import { useLoadsStore } from '@/store/loads';
import { colors, radii, spacing, type } from '@/theme';

/** Create a load folder — the header record for a run. */
export default function AddLoadScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const addLoad = useLoadsStore((s) => s.addLoad);

  const [loadNumber, setLoadNumber] = useState('');
  const [broker, setBroker] = useState('');
  const [origin, setOrigin] = useState('');
  const [destination, setDestination] = useState('');
  const [note, setNote] = useState('');

  const canSave = loadNumber.trim().length > 0;

  const save = () => {
    if (!canSave) return;
    addLoad({ loadNumber, broker, origin, destination, note });
    router.back();
  };

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <View style={styles.headerRow}>
          <Text style={styles.kicker}>Load Packets</Text>
          <Pressable
            accessibilityLabel="Close"
            onPress={() => router.back()}
            style={styles.closeBtn}
          >
            <Text style={styles.closeText}>✕</Text>
          </Pressable>
        </View>
        <Text style={styles.title}>New load</Text>
        <Text style={styles.subtitle}>
          Start the folder — documents and detention file in later.
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + spacing.xxl }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.card}>
          <Field label="Load number">
            <TextInput
              value={loadNumber}
              onChangeText={setLoadNumber}
              placeholder="e.g. 48291"
              placeholderTextColor="rgba(30,35,39,0.3)"
              style={styles.input}
              accessibilityLabel="Load number"
            />
          </Field>
          <Field label="Broker (optional)">
            <TextInput
              value={broker}
              onChangeText={setBroker}
              placeholder="Broker or shipper"
              placeholderTextColor="rgba(30,35,39,0.3)"
              style={styles.input}
              accessibilityLabel="Broker"
            />
          </Field>
          <Field label="Pickup (optional)">
            <TextInput
              value={origin}
              onChangeText={setOrigin}
              placeholder="City, ST"
              placeholderTextColor="rgba(30,35,39,0.3)"
              style={styles.input}
              accessibilityLabel="Pickup"
            />
          </Field>
          <Field label="Delivery (optional)">
            <TextInput
              value={destination}
              onChangeText={setDestination}
              placeholder="City, ST"
              placeholderTextColor="rgba(30,35,39,0.3)"
              style={styles.input}
              accessibilityLabel="Delivery"
            />
          </Field>
          <Field label="Note (optional)">
            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder="Appointment, commodity…"
              placeholderTextColor="rgba(30,35,39,0.3)"
              style={styles.input}
              accessibilityLabel="Note"
            />
          </Field>
        </View>

        <Button label="Create load" disabled={!canSave} onPress={save} />
      </ScrollView>
    </View>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
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
  input: {
    ...type.body,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    color: colors.text,
    marginTop: 4,
    paddingVertical: spacing.sm,
  },
});
