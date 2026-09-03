import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { Button, Card, Pill, Screen } from '@/components';
import { CarrierPacketGate } from '@/components/roadWallet/CarrierGates';
import { shareErrorCopy } from '@/components/roadWallet/errorCopy';
import {
  CarrierPacketDeniedError,
  createUpdatedCarrierPacket,
  liveReviewCarrierPacket,
  markCarrierPacketReady,
  markCarrierPacketShared,
  packetItems,
  refreshCarrierPacketItem,
  restoreCarrierPacketItem,
  returnCarrierPacketToDraft,
  setCarrierPacketItemDocument,
  shareCarrierPacketItem,
} from '@/data/carrierPackets';
import { ShareDeniedError } from '@/data/roadWallet';
import {
  canUseFeature,
  CARRIER_PACKET_DISCLAIMER,
  CARRIER_PACKET_REQUIREMENTS_VARY_COPY,
  matchingDocumentsForKind,
  MARK_SHARED_ATTESTATION_COPY,
  requiredShareConfirmation,
  SHARE_CONFIRMATION_COPY,
} from '@/domain';
import { useAuthStore } from '@/store/auth';
import { useCarrierPacketsStore } from '@/store/carrierPackets';
import { useRoadWalletStore } from '@/store/roadWallet';
import { useSubscriptionStore } from '@/store/subscription';
import { colors, spacing, type } from '@/theme';

export default function CarrierPacketDetailRoute() {
  return (
    <CarrierPacketGate>
      <CarrierPacketDetailScreen />
    </CarrierPacketGate>
  );
}

function CarrierPacketDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const userId = useAuthStore((s) => s.userId);
  const tier = useSubscriptionStore((s) => s.tier);
  const packet = useCarrierPacketsStore((s) => s.packets.find((p) => p.id === id));
  const documents = useRoadWalletStore((s) => s.documents);
  const [notice, setNotice] = useState<string | null>(null);
  const [recipient, setRecipient] = useState(packet?.recipientLabel ?? '');
  const [confirmShared, setConfirmShared] = useState(false);
  const review = id ? liveReviewCarrierPacket(id) : null;
  const items = id ? packetItems(id) : [];

  if (!packet || packet.accountOwnerId !== userId) {
    return (
      <Screen kicker="Carrier" title="Packet">
        <Text style={styles.muted}>This packet is not visible in this session.</Text>
      </Screen>
    );
  }

  const run = (fn: () => void) => {
    try {
      fn();
      setNotice(null);
    } catch (err) {
      if (err instanceof CarrierPacketDeniedError && err.reason === 'NOT_ENTITLED') {
        router.push({ pathname: '/paywall', params: { trigger: 'carrier_packet_builder' } });
        return;
      }
      setNotice(err instanceof Error ? err.message : 'Could not update this packet.');
    }
  };

  return (
    <Screen kicker="Carrier packet" title={packet.name}>
      <Text style={styles.disclaimer}>{CARRIER_PACKET_DISCLAIMER}</Text>
      <Text style={styles.muted}>{CARRIER_PACKET_REQUIREMENTS_VARY_COPY}</Text>
      <Card label="Status" labelRight={packet.status} style={styles.block}>
        <Text style={styles.body}>
          Template: {packet.templateSnapshot.name}
          {packet.templateSourceKind === 'BUILTIN' ? ' (product default)' : ''}
        </Text>
        <Text style={styles.muted}>
          Profile: {packet.profileSnapshot?.legalName ?? 'Missing — entered by you, not verified'}
        </Text>
      </Card>
      {review?.findings.map((f) => (
        <Card key={`${f.code}-${f.requirementKey ?? ''}`} style={styles.block}>
          <Pill label={f.severity} tone={f.severity === 'BLOCKER' ? 'rust' : 'amber'} />
          <Text style={styles.body}>{f.message}</Text>
        </Card>
      ))}
      {packet.templateSnapshot.documentRequirements.map((req) => {
        const item = items.find((i) => i.requirementKey === req.key);
        const candidates = matchingDocumentsForKind(req.documentKind, documents, userId);
        return (
          <Card key={req.key} label={req.label} labelRight={req.required ? 'Required' : 'Optional'} style={styles.block}>
            <Text style={styles.muted}>
              {item
                ? `Exact version ${item.documentVersionId.slice(0, 6)}… · ${item.sensitivitySnapshot}`
                : 'No document selected'}
            </Text>
            {packet.status === 'DRAFT' &&
              candidates.map((doc) => (
                <Button
                  key={doc.id}
                  label={`Use ${doc.title}`}
                  variant="secondary"
                  onPress={() =>
                    run(() => {
                      setCarrierPacketItemDocument(packet.id, req.key, doc.id);
                    })
                  }
                />
              ))}
            {packet.status === 'DRAFT' && item && (
              <Button
                label="Refresh to current version"
                variant="secondary"
                onPress={() => run(() => refreshCarrierPacketItem(packet.id, req.key))}
              />
            )}
            {packet.status === 'READY' && item && (
              <ReadyItemActions
                packetId={packet.id}
                itemId={item.id}
                sensitivity={item.sensitivitySnapshot}
                canShare={canUseFeature(tier, 'documentShareExport')}
                onNotice={setNotice}
              />
            )}
          </Card>
        );
      })}
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}
      <View style={styles.row}>
        {packet.status === 'DRAFT' && (
          <Button
            label="Mark packet ready"
            onPress={() =>
              run(() => {
                markCarrierPacketReady(packet.id);
              })
            }
          />
        )}
        {packet.status === 'READY' && (
          <>
            <Button
              label="Return to draft"
              variant="secondary"
              onPress={() => run(() => returnCarrierPacketToDraft(packet.id))}
            />
            <Text style={styles.muted}>{MARK_SHARED_ATTESTATION_COPY}</Text>
            <TextInput
              value={recipient}
              onChangeText={setRecipient}
              placeholder="Recipient label (optional)"
              placeholderTextColor={colors.textFaint}
              style={styles.input}
            />
            <Button
              label={confirmShared ? 'Attestation recorded — tap to mark shared' : 'I attest this snapshot was shared'}
              variant="secondary"
              onPress={() => setConfirmShared(true)}
            />
            <Button
              label="Mark packet shared"
              onPress={() =>
                run(() => {
                  markCarrierPacketShared({
                    packetId: packet.id,
                    confirmed: confirmShared,
                    recipientLabel: recipient || null,
                    shareMethod: 'OS_SHARE_SHEET',
                  });
                })
              }
            />
          </>
        )}
        {(packet.status === 'SHARED' || packet.status === 'SUPERSEDED') && (
          <Button
            label="Create updated packet"
            onPress={() => {
              const next = createUpdatedCarrierPacket(packet.id);
              router.push({ pathname: '/carrier-packet-review', params: { id: next.id } });
            }}
          />
        )}
        {!packet.profileSnapshot && (
          <Button
            label="Create Carrier Profile"
            variant="secondary"
            onPress={() => router.push('/carrier-profile')}
          />
        )}
        <Button
          label="Add Road Document"
          variant="secondary"
          onPress={() => router.push('/add-road-document')}
        />
        <Button label="Back" variant="secondary" onPress={() => router.back()} />
      </View>
    </Screen>
  );
}

function ReadyItemActions({
  packetId,
  itemId,
  sensitivity,
  canShare,
  onNotice,
}: {
  packetId: string;
  itemId: string;
  sensitivity: 'STANDARD' | 'PERSONAL_SENSITIVE' | 'FINANCIAL_SENSITIVE';
  canShare: boolean;
  onNotice: (s: string | null) => void;
}) {
  const router = useRouter();
  const [ack, setAck] = useState(false);
  const required = requiredShareConfirmation(sensitivity);
  const copy =
    required === 'PERSONAL_ACKNOWLEDGED'
      ? SHARE_CONFIRMATION_COPY.PERSONAL_ACKNOWLEDGED
      : required === 'FINANCIAL_ACKNOWLEDGED'
        ? SHARE_CONFIRMATION_COPY.FINANCIAL_ACKNOWLEDGED
        : null;
  return (
    <View style={styles.row}>
      {copy && !ack && (
        <>
          <Text style={styles.muted}>{copy.body}</Text>
          <Button label={copy.confirm} variant="secondary" onPress={() => setAck(true)} />
        </>
      )}
      {canShare && (!copy || ack) && (
        <Button
          label="Share / Export"
          variant="secondary"
          onPress={() => {
            void shareCarrierPacketItem({
              packetId,
              itemId,
              sensitiveConfirmation: required === 'NONE' ? 'NONE' : required,
            }).catch((err) => {
              if (err instanceof ShareDeniedError && err.reason === 'NOT_ENTITLED') {
                router.push({ pathname: '/paywall', params: { trigger: 'document_share_export' } });
                return;
              }
              if (err instanceof ShareDeniedError && err.reason === 'FILE_UNAVAILABLE') {
                void restoreCarrierPacketItem(packetId, itemId)
                  .then(() => onNotice('Restored the exact version. Share again after it verifies.'))
                  .catch(() => onNotice(shareErrorCopy(err).body));
                return;
              }
              onNotice(shareErrorCopy(err).body);
            });
          }}
        />
      )}
      <Button
        label="Restore to this device"
        variant="secondary"
        onPress={() => {
          void restoreCarrierPacketItem(packetId, itemId)
            .then(() => onNotice('Exact version restored. Verify before Share / Export.'))
            .catch((err) => onNotice(shareErrorCopy(err).body));
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  disclaimer: { ...type.bodySmall, color: colors.textFaint, marginBottom: spacing.sm },
  muted: { ...type.bodySmall, color: colors.textMuted, marginTop: spacing.sm },
  body: { ...type.body, color: colors.text, marginTop: spacing.sm },
  block: { marginTop: spacing.md },
  row: { marginTop: spacing.md, gap: spacing.sm },
  notice: { ...type.bodySmall, color: colors.warning, marginTop: spacing.md },
  input: { ...type.body, color: colors.text, marginTop: spacing.sm },
});
