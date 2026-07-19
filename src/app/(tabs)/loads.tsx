import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Card, Pill, RouteBand, Screen } from '@/components';
import { isOpenLoad, loadStatusLabel, loadStatusTone, nextLoadStatus } from '@/domain';
import { useLoadsStore } from '@/store/loads';
import { colors, spacing, type } from '@/theme';

/**
 * Load packets (Loop 5). Create a load folder, track its lifecycle status, and
 * keep a running list. Document packets (BOL/POD/scale/lumper) and detention
 * link in from captures in a later phase.
 */
export default function LoadsScreen() {
  const router = useRouter();
  const loads = useLoadsStore((s) => s.loads);
  const setStatus = useLoadsStore((s) => s.setStatus);
  const removeLoad = useLoadsStore((s) => s.removeLoad);

  const activeCount = loads.filter((l) => isOpenLoad(l.status)).length;
  const hasLoads = loads.length > 0;

  return (
    <Screen
      kicker="Load Packets"
      title="Every run has a paper trail."
      headerRight={
        <Pill label={`${activeCount} active`} tone={activeCount > 0 ? 'blue' : 'neutral'} />
      }
    >
      {!hasLoads && (
        <Card label="No loads yet">
          <Text style={styles.emptyTitle}>Start a folder for your next run.</Text>
          <Text style={styles.emptyCopy}>
            Each load keeps its number, broker, and route together. Documents — BOL, POD, scale
            tickets, lumper receipts — and detention will file into the packet from your scans.
          </Text>
        </Card>
      )}

      <RouteBand
        marker="＋"
        markerTone="green"
        title="Create a load"
        subtitle="Load number, broker, pickup and delivery — 30 seconds."
        value="Add"
        onPress={() => router.push('/add-load')}
      />

      {hasLoads &&
        loads.map((l) => (
          <Card
            key={l.id}
            label={`Load ${l.loadNumber}`}
            labelRight={l.broker ?? undefined}
            style={styles.loadCard}
          >
            {(l.origin || l.destination) && (
              <Text style={styles.route}>
                {l.origin ?? '—'} → {l.destination ?? '—'}
              </Text>
            )}
            {l.note && <Text style={styles.note}>{l.note}</Text>}
            <View style={styles.actions}>
              <Pressable
                accessibilityLabel="Advance status"
                onPress={() => setStatus(l.id, nextLoadStatus(l.status))}
              >
                <Pill label={loadStatusLabel(l.status)} tone={loadStatusTone(l.status)} />
              </Pressable>
              <View style={{ flex: 1 }} />
              <Pressable
                accessibilityLabel="Remove load"
                hitSlop={8}
                onPress={() => removeLoad(l.id)}
              >
                <Text style={styles.remove}>Remove</Text>
              </Pressable>
            </View>
            <Text style={styles.tapHint}>Tap the status to advance it.</Text>
          </Card>
        ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  emptyTitle: {
    ...type.h2,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  emptyCopy: {
    ...type.body,
    color: colors.textMuted,
  },
  loadCard: { marginTop: spacing.md },
  route: { ...type.emphasis, color: colors.text },
  note: { ...type.bodySmall, color: colors.textMuted, marginTop: spacing.xs },
  actions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  remove: { ...type.labelTiny, color: colors.textMuted },
  tapHint: { ...type.labelTiny, color: colors.textMuted, marginTop: spacing.sm },
});
