import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { Button, Card, ChoiceRow, Screen } from '@/components';
import { CarrierPacketGate } from '@/components/roadWallet/CarrierGates';
import { isFeatureEnabled } from '@/config/flags';
import { createCarrierPacketDraft } from '@/data/carrierPackets';
import {
  canViewCarrierHistory,
  CARRIER_PACKET_DISCLAIMER,
  CARRIER_PACKET_REQUIREMENTS_VARY_COPY,
} from '@/domain';
import { useAuthStore } from '@/store/auth';
import {
  selectDraftReadyPackets,
  selectHistoryPackets,
  useCarrierPacketsStore,
} from '@/store/carrierPackets';
import { useSubscriptionStore } from '@/store/subscription';
import { colors, spacing, type } from '@/theme';

export default function CarrierPacketsRoute() {
  return (
    <CarrierPacketGate>
      <CarrierPacketsScreen />
    </CarrierPacketGate>
  );
}

function CarrierPacketsScreen() {
  const router = useRouter();
  const userId = useAuthStore((s) => s.userId);
  const tier = useSubscriptionStore((s) => s.tier);
  const packets = useCarrierPacketsStore((s) => s.packets);
  const open = selectDraftReadyPackets(packets, userId);
  const historyOn =
    isFeatureEnabled('carrier_packet_history_enabled') && canViewCarrierHistory(tier);
  const history = historyOn ? selectHistoryPackets(packets, userId) : [];

  const create = (kind: 'BUILTIN') => {
    const packet = createCarrierPacketDraft({ source: { kind } });
    router.push({ pathname: '/carrier-packet-review', params: { id: packet.id } });
  };

  return (
    <Screen kicker="Carrier" title="Carrier Packets">
      <Text style={styles.disclaimer}>{CARRIER_PACKET_DISCLAIMER}</Text>
      <Text style={styles.muted}>{CARRIER_PACKET_REQUIREMENTS_VARY_COPY}</Text>
      <View style={styles.row}>
        <Button label="Create packet" onPress={() => create('BUILTIN')} />
        <Button
          label="Custom template"
          variant="secondary"
          onPress={() => router.push('/carrier-packet-template-edit')}
        />
      </View>
      <Card label="Draft / Ready" style={styles.block}>
        {open.length === 0 ? (
          <Text style={styles.muted}>No open packets.</Text>
        ) : (
          open.map((p) => (
            <ChoiceRow
              key={p.id}
              title={p.name}
              subtitle={p.status}
              onPress={() =>
                router.push({ pathname: '/carrier-packet-detail', params: { id: p.id } })
              }
            />
          ))
        )}
      </Card>
      {historyOn && (
        <Card label="Shared history" style={styles.block}>
          {history.length === 0 ? (
            <Text style={styles.muted}>No shared snapshots yet.</Text>
          ) : (
            history.map((p) => (
              <ChoiceRow
                key={p.id}
                title={p.name}
                subtitle={p.status}
                onPress={() =>
                  router.push({ pathname: '/carrier-packet-detail', params: { id: p.id } })
                }
              />
            ))
          )}
        </Card>
      )}
      <View style={styles.row}>
        <Button label="Back" variant="secondary" onPress={() => router.back()} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  disclaimer: { ...type.bodySmall, color: colors.textFaint, marginBottom: spacing.sm },
  muted: { ...type.bodySmall, color: colors.textMuted },
  block: { marginTop: spacing.md },
  row: { marginTop: spacing.md, gap: spacing.sm },
});
