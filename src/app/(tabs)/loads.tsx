import { useRouter } from 'expo-router';
import { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Card, NextActionCard, Pill, RouteBand, Screen } from '@/components';
import { launchAction } from '@/data/launchAction';
import { useActionItems } from '@/data/useActionItems';
import {
  actionItemsForLoad,
  groupLoadsForList,
  loadStatusLabel,
  loadStatusTone,
  nextLoadStatus,
} from '@/domain';
import { normalizeLoad, useLoadsStore } from '@/store/loads';
import { colors, palette, spacing, type } from '@/theme';

/**
 * Load packets. Grouping is derived presentation (Active / Needs Action /
 * Closed), not a new lifecycle.
 */
export default function LoadsScreen() {
  const router = useRouter();
  const loads = useLoadsStore((s) => s.loads.map(normalizeLoad));
  const setStatus = useLoadsStore((s) => s.setStatus);
  const removeLoad = useLoadsStore((s) => s.removeLoad);
  const actionItems = useActionItems();
  const grouped = groupLoadsForList(loads, actionItems);
  const hasLoads = loads.length > 0;

  return (
    <Screen
      kicker="Load Packets"
      title="Every run has a paper trail."
      headerRight={
        <Pill
          label={`${grouped.active.length + grouped.needsAction.length} open`}
          tone={hasLoads ? 'blue' : 'neutral'}
        />
      }
    >
      {!hasLoads && (
        <Card label="No loads yet">
          <Text style={styles.emptyTitle}>Start a folder for your next run.</Text>
          <Text style={styles.emptyCopy}>
            Each load keeps its number, broker, and route together. Missing POD, unfinished
            economics, and money owed appear under Needs Action — derived from this device, not a
            second workflow database.
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

      {grouped.needsAction.length > 0 && (
        <Section title="Needs Action" count={grouped.needsAction.length}>
          {grouped.needsAction.map((l) => {
            const next = actionItemsForLoad(actionItems, l.id)[0];
            return (
              <View key={l.id}>
                <LoadCard
                  load={l}
                  onAdvance={() => setStatus(l.id, nextLoadStatus(l.status))}
                  onOpen={() => router.push({ pathname: '/load-detail', params: { id: l.id } })}
                  onRemove={() => removeLoad(l.id)}
                />
                {next && (
                  <NextActionCard
                    item={next}
                    ctaLabel={next.kind === 'missing_document' ? 'Scan' : 'Open'}
                    onPress={() => launchAction(next, router)}
                  />
                )}
              </View>
            );
          })}
        </Section>
      )}

      {grouped.active.length > 0 && (
        <Section title="Active" count={grouped.active.length}>
          {grouped.active.map((l) => (
            <LoadCard
              key={l.id}
              load={l}
              onAdvance={() => setStatus(l.id, nextLoadStatus(l.status))}
              onOpen={() => router.push({ pathname: '/load-detail', params: { id: l.id } })}
              onRemove={() => removeLoad(l.id)}
            />
          ))}
        </Section>
      )}

      {grouped.closed.length > 0 && (
        <Section title="Closed" count={grouped.closed.length}>
          {grouped.closed.map((l) => (
            <LoadCard
              key={l.id}
              load={l}
              onAdvance={() => setStatus(l.id, nextLoadStatus(l.status))}
              onOpen={() => router.push({ pathname: '/load-detail', params: { id: l.id } })}
              onRemove={() => removeLoad(l.id)}
            />
          ))}
        </Section>
      )}
    </Screen>
  );
}

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: ReactNode;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <Text style={styles.sectionTitle}>{title}</Text>
        <Text style={styles.sectionCount}>{count}</Text>
      </View>
      {children}
    </View>
  );
}

function LoadCard({
  load,
  onAdvance,
  onOpen,
  onRemove,
}: {
  load: {
    id: string;
    loadNumber: string;
    broker: string | null;
    origin: string | null;
    destination: string | null;
    note: string | null;
    status: Parameters<typeof loadStatusLabel>[0];
  };
  onAdvance: () => void;
  onOpen: () => void;
  onRemove: () => void;
}) {
  return (
    <Card
      label={`Load ${load.loadNumber}`}
      labelRight={load.broker ?? undefined}
      style={styles.loadCard}
    >
      {(load.origin || load.destination) && (
        <Text style={styles.route}>
          {load.origin ?? '—'} → {load.destination ?? '—'}
        </Text>
      )}
      {load.note && <Text style={styles.note}>{load.note}</Text>}
      <View style={styles.actions}>
        <Pressable accessibilityLabel="Advance status" onPress={onAdvance}>
          <Pill label={loadStatusLabel(load.status)} tone={loadStatusTone(load.status)} />
        </Pressable>
        <View style={{ flex: 1 }} />
        <Pressable accessibilityLabel="Open load details" hitSlop={8} onPress={onOpen}>
          <Text style={styles.details}>Details →</Text>
        </Pressable>
        <Text style={styles.dot}>·</Text>
        <Pressable accessibilityLabel="Remove load" hitSlop={8} onPress={onRemove}>
          <Text style={styles.remove}>Remove</Text>
        </Pressable>
      </View>
      <Text style={styles.tapHint}>
        Tap the status to advance it. Open details for the Load Economics Packet.
      </Text>
    </Card>
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
  section: { marginTop: spacing.lg },
  sectionHead: {
    alignItems: 'baseline',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  sectionTitle: { ...type.h2, color: colors.text },
  sectionCount: { ...type.labelTiny, color: colors.textMuted },
  loadCard: { marginTop: spacing.md },
  route: { ...type.emphasis, color: colors.text },
  note: { ...type.bodySmall, color: colors.textMuted, marginTop: spacing.xs },
  actions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  details: { ...type.labelTiny, color: palette.highwayBlue },
  dot: { color: colors.textMuted },
  remove: { ...type.labelTiny, color: colors.textMuted },
  tapHint: { ...type.labelTiny, color: colors.textMuted, marginTop: spacing.sm },
});
