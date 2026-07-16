import { StyleSheet, Text } from 'react-native';

import { Card, Pill, RouteBand, Screen } from '@/components';
import { colors, spacing, type } from '@/theme';

/** Load packets (Loop 5). Create/edit, documents, and packet status arrive in Phase 8. */
export default function LoadsScreen() {
  return (
    <Screen
      kicker="Load Packets"
      title="Every run has a paper trail."
      headerRight={<Pill label="0 active" tone="blue" />}
    >
      <Card label="No loads yet">
        <Text style={styles.emptyTitle}>Start a folder for your next run.</Text>
        <Text style={styles.emptyCopy}>
          Each load keeps its BOL, POD, rate confirmation, scale tickets, lumper receipts, expenses,
          and detention in one packet — ready to export.
        </Text>
      </Card>

      <RouteBand
        marker="＋"
        markerTone="green"
        title="Create your first load"
        subtitle="Load number, broker, pickup and delivery — 30 seconds."
        value="Soon"
      />
      <RouteBand
        marker="B"
        markerTone="blue"
        title="Scan a BOL straight to a load"
        subtitle="The Scan tab files documents into the right packet."
        value="Soon"
      />
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
});
