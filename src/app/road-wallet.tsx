import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Button, Card, MetricTile, Pill, RouteBand, Screen } from '@/components';
import { isFeatureEnabled } from '@/config/flags';
import { RoadWalletGate } from '@/components/roadWallet/RoadWalletGate';
import { refreshRoadWalletReadinessForSession } from '@/data/roadWallet';
import { useRoadWalletSummary } from '@/data/useRoadWalletSummary';
import {
  BACKUP_STATE_LABEL,
  backupState,
  currentVersion,
  deriveValidity,
  documentKindLabel,
  DocumentVersion,
  OperationalDocument,
  READINESS_LABEL,
  ROAD_WALLET_DISCLAIMER,
  VALIDITY_LABEL,
  ValidityState,
} from '@/domain';
import { useAuthStore } from '@/store/auth';
import {
  selectActiveVisibleDocuments,
  selectArchivedVisibleDocuments,
  useRoadWalletStore,
} from '@/store/roadWallet';
import { colors, spacing, Tone, type } from '@/theme';

/**
 * Road Wallet — manage reusable operational documents (registrations,
 * insurance, permits, credentials, carrier paperwork). Feature-flagged; Free is
 * fully local. Rows show only useful metadata: kind/title, subject, expiry
 * state and current-runtime offline readiness — never paths, hashes or
 * storage locations. Documents are archived, never deleted here.
 */
export default function RoadWalletRoute() {
  return (
    <RoadWalletGate>
      <RoadWalletScreen />
    </RoadWalletGate>
  );
}

const VALIDITY_TONE: Record<ValidityState, Tone> = {
  NO_EXPIRATION: 'neutral',
  CURRENT: 'green',
  EXPIRING_SOON: 'amber',
  EXPIRED: 'rust',
};

function RoadWalletScreen() {
  const router = useRouter();
  const userId = useAuthStore((s) => s.userId);
  const documents = useRoadWalletStore((s) => s.documents);
  const versions = useRoadWalletStore((s) => s.versions);
  const summary = useRoadWalletSummary();
  const [showArchived, setShowArchived] = useState(false);

  // Readiness is re-verified in THIS process every time the wallet is focused;
  // rehydrated state is never trusted as READY.
  useFocusEffect(
    useCallback(() => {
      void refreshRoadWalletReadinessForSession(userId).catch(() => {});
    }, [userId]),
  );

  const active = useMemo(
    () => selectActiveVisibleDocuments({ documents, versions }, userId),
    [documents, versions, userId],
  );
  const archived = useMemo(
    () => selectArchivedVisibleDocuments({ documents, versions }, userId),
    [documents, versions, userId],
  );
  const now = new Date();

  return (
    <Screen
      kicker="Road Wallet"
      title="Your papers, ready for the road."
      headerRight={
        <Pill
          label={summary.totalActive > 0 ? `${summary.totalActive} active` : 'Empty'}
          tone={summary.totalActive > 0 ? 'green' : 'neutral'}
        />
      }
    >
      <Card label="Summary" labelRight={userId ? 'Your account' : 'This device'}>
        <View style={styles.metricRow}>
          <MetricTile label="Ready offline" value={String(summary.readyOffline)} />
          <MetricTile label="Checking" value={String(summary.needsFileCheck)} />
          <MetricTile label="Backed up" value={String(summary.backedUp)} />
        </View>
        <View style={styles.metricRow}>
          <MetricTile label="Expiring soon" value={String(summary.expiringSoon)} />
          <MetricTile label="Expired" value={String(summary.expired)} />
          <MetricTile label="Archived" value={String(summary.archived)} />
        </View>
        <Text style={styles.disclaimer}>{ROAD_WALLET_DISCLAIMER}</Text>
      </Card>

      <View style={styles.addRow}>
        <Button label="Add document" onPress={() => router.push('/add-road-document')} />
        {isFeatureEnabled('quick_present_enabled') && (
          <Button
            label="Quick Present"
            variant="secondary"
            onPress={() => router.push('/quick-present')}
          />
        )}
      </View>

      {(isFeatureEnabled('carrier_profile_enabled') ||
        isFeatureEnabled('carrier_packet_builder_enabled')) && (
        <Card label="Carrier" style={styles.emptyCard}>
          {isFeatureEnabled('carrier_profile_enabled') && (
            <RouteBand
              marker="ID"
              markerTone="neutral"
              title="Carrier Profile"
              subtitle="Details you entered — not verified."
              onPress={() => router.push('/carrier-profile')}
            />
          )}
          {isFeatureEnabled('carrier_packet_builder_enabled') && (
            <RouteBand
              marker="PK"
              markerTone="neutral"
              title="Carrier Packets"
              subtitle="Prepare and review an exact snapshot."
              onPress={() => router.push('/carrier-packets')}
            />
          )}
        </Card>
      )}

      {active.length === 0 ? (
        <Card style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>Nothing in your wallet yet.</Text>
          <Text style={styles.emptyCopy}>
            Add a registration, insurance card, IFTA license, permit, CDL or carrier paperwork.
            Files stay on this device; Driver Pro adds private cloud backup and recovery.
          </Text>
        </Card>
      ) : (
        active.map((doc) => (
          <DocumentRow
            key={doc.id}
            doc={doc}
            current={currentVersion(versions, doc.id)}
            now={now}
            onPress={() => router.push({ pathname: '/document-detail', params: { id: doc.id } })}
          />
        ))
      )}

      {archived.length > 0 && (
        <View style={styles.archivedBlock}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              showArchived ? 'Hide archived documents' : 'Show archived documents'
            }
            onPress={() => setShowArchived((v) => !v)}
            style={styles.archivedToggle}
          >
            <Text style={styles.archivedLabel}>
              Archived ({archived.length}) {showArchived ? '▲' : '▼'}
            </Text>
          </Pressable>
          {showArchived &&
            archived.map((doc) => (
              <DocumentRow
                key={doc.id}
                doc={doc}
                current={currentVersion(versions, doc.id)}
                now={now}
                archived
                onPress={() =>
                  router.push({ pathname: '/document-detail', params: { id: doc.id } })
                }
              />
            ))}
        </View>
      )}
    </Screen>
  );
}

function DocumentRow({
  doc,
  current,
  now,
  archived,
  onPress,
}: {
  doc: OperationalDocument;
  current: DocumentVersion | null;
  now: Date;
  archived?: boolean;
  onPress: () => void;
}) {
  const validity = deriveValidity(doc.expiresAt, now);
  const readiness = current ? READINESS_LABEL[current.fileCache.state] : 'No file';
  const readinessTone: Tone =
    current?.fileCache.state === 'READY'
      ? 'green'
      : current?.fileCache.state === 'ERROR'
        ? 'rust'
        : 'neutral';
  const subtitleParts = [
    documentKindLabel(doc.documentKind),
    doc.subjectKind !== 'GENERAL' ? doc.subjectKind.toLowerCase() : null,
    doc.expiresAt ? `${VALIDITY_LABEL[validity]} · ${doc.expiresAt}` : VALIDITY_LABEL.NO_EXPIRATION,
    BACKUP_STATE_LABEL[backupState(doc, current)],
  ].filter((p): p is string => !!p);

  return (
    <RouteBand
      marker={
        archived ? '▤' : validity === 'EXPIRED' ? '!' : validity === 'EXPIRING_SOON' ? '◔' : '✓'
      }
      markerTone={archived ? 'neutral' : VALIDITY_TONE[validity]}
      title={doc.title}
      subtitle={subtitleParts.join(' · ')}
      value={
        <Pill
          label={archived ? 'Archived' : readiness}
          tone={archived ? 'neutral' : readinessTone}
        />
      }
      onPress={onPress}
    />
  );
}

const styles = StyleSheet.create({
  metricRow: { flexDirection: 'row', gap: spacing.sm + 2, marginTop: spacing.sm },
  disclaimer: { ...type.bodySmall, color: colors.textFaint, marginTop: spacing.md },
  addRow: { marginTop: spacing.lg, gap: spacing.sm },
  emptyCard: { marginTop: spacing.md },
  emptyTitle: { ...type.h2, color: colors.text },
  emptyCopy: { ...type.body, color: colors.textMuted, marginTop: spacing.sm },
  archivedBlock: { marginTop: spacing.xl },
  archivedToggle: { paddingVertical: spacing.sm },
  archivedLabel: { ...type.label, color: colors.textMuted },
});
