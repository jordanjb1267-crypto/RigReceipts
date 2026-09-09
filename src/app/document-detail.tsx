import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Card, Pill } from '@/components';
import { DocumentSourceSheet, SourceOutcome } from '@/components/roadWallet/DocumentSourceSheet';
import { restoreErrorCopy, saveErrorCopy, shareErrorCopy } from '@/components/roadWallet/errorCopy';
import { RoadWalletGate } from '@/components/roadWallet/RoadWalletGate';
import { currentCloudSyncContext } from '@/data/cloudSyncAuth';
import { syncPendingRoadWallet } from '@/data/documentSync';
import {
  refreshDocumentReadiness,
  replaceOperationalDocumentFile,
  roadWalletFileStore,
  ShareDeniedError,
  shareOperationalDocumentVersion,
} from '@/data/roadWallet';
import { restoreDocumentVersionToDevice } from '@/data/roadWalletRecovery';
import { useOwnedTrucks, resolveTruckLabel } from '@/data/trucks';
import {
  BACKUP_STATE_LABEL,
  backupState,
  canUseFeature,
  currentVersion,
  deriveValidity,
  DOCUMENT_KINDS,
  DocumentKind,
  documentKindLabel,
  DocumentVersion,
  isIsoDate,
  maskReference,
  READINESS_LABEL,
  requiredSensitivityForKind,
  requiredShareConfirmation,
  ROAD_WALLET_DISCLAIMER,
  SensitiveShareConfirmation,
  SHARE_CONFIRMATION_COPY,
  VALIDITY_LABEL,
  versionsForDocument,
} from '@/domain';
import { useAuthStore } from '@/store/auth';
import { selectDocumentById, useRoadWalletStore } from '@/store/roadWallet';
import { useSubscriptionStore } from '@/store/subscription';
import { colors, radii, spacing, Tone, type } from '@/theme';

/**
 * Document Detail: metadata, derived validity, current-runtime readiness,
 * backup truth, version history, bounded editing, file replacement (N → N+1),
 * archive/restore, and entitlement- and integrity-gated Share/Export. Shows no
 * paths, hashes or storage locations. Never offers deletion.
 */
export default function DocumentDetailRoute() {
  return (
    <RoadWalletGate>
      <DocumentDetailScreen />
    </RoadWalletGate>
  );
}

type Mode = 'view' | 'edit' | 'replace';

function DocumentDetailScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const userId = useAuthStore((s) => s.userId);
  const tier = useSubscriptionStore((s) => s.tier);
  const documents = useRoadWalletStore((s) => s.documents);
  const versions = useRoadWalletStore((s) => s.versions);
  const trucks = useOwnedTrucks(userId);

  const doc = useMemo(
    () => (id ? selectDocumentById({ documents, versions }, id, userId) : null),
    [documents, versions, id, userId],
  );
  const history = useMemo(
    () => (doc ? versionsForDocument(versions, doc.id) : []),
    [versions, doc],
  );
  const current = doc ? currentVersion(versions, doc.id) : null;

  const [mode, setMode] = useState<Mode>('view');
  const [busy, setBusy] = useState<'share' | 'replace' | 'save' | 'restore' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Readiness is re-verified in this process when the detail opens.
  const docId = doc?.id ?? null;
  useEffect(() => {
    if (docId) void refreshDocumentReadiness(docId).catch(() => {});
  }, [docId]);

  if (!doc) {
    return (
      <Shell title="Document" onClose={() => router.back()} insets={insets}>
        <Card>
          <Text style={styles.h2}>Document unavailable</Text>
          <Text style={styles.copy}>
            This document is not available in the current account. Sign in with the account that
            saved it, or return to your wallet.
          </Text>
        </Card>
      </Shell>
    );
  }

  const now = new Date();
  const validity = deriveValidity(doc.expiresAt, now);
  const backup = backupState(doc, current);
  const readiness = current?.fileCache.state ?? 'NOT_CACHED';
  const canShare = canUseFeature(tier, 'documentShareExport');
  const truckLabel = resolveTruckLabel(doc.truckId, trucks.data);
  // Restore is a data-access right of the signed-in owner of already backed-up
  // data — independent of the current tier and of Share/Export.
  const canRestore =
    !!userId && !!current && current.cloudStatus === 'synced' && readiness !== 'READY';

  const runRestore = async () => {
    setBusy('restore');
    setNotice(null);
    try {
      await restoreDocumentVersionToDevice(doc.id);
      setNotice('Restored to this device and verified.');
    } catch (err) {
      setNotice(restoreErrorCopy(err));
    } finally {
      setBusy(null);
    }
  };

  const restore = () => {
    if (doc.sensitivity === 'FINANCIAL_SENSITIVE') {
      Alert.alert(
        'Restore a financial document to this device?',
        'Restoring places an app-private local copy of this document on this device, protected by the platform’s app storage protections. Continue only on a device you control.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Restore to this device', onPress: () => void runRestore() },
        ],
      );
      return;
    }
    void runRestore();
  };

  const archiveToggle = () => {
    const ctx = currentCloudSyncContext();
    if (doc.lifecycle === 'ACTIVE') {
      Alert.alert(
        'Archive this document?',
        'It leaves your active wallet but nothing is deleted — every version stays and you can restore it any time.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Archive',
            onPress: () => {
              useRoadWalletStore.getState().archiveDocument(doc.id, ctx);
              void syncPendingRoadWallet().catch(() => {});
            },
          },
        ],
      );
    } else {
      useRoadWalletStore.getState().restoreDocument(doc.id, ctx);
      void syncPendingRoadWallet().catch(() => {});
    }
  };

  const doShare = async (confirmation: SensitiveShareConfirmation) => {
    setBusy('share');
    setNotice(null);
    try {
      await shareOperationalDocumentVersion({
        documentId: doc.id,
        sensitiveConfirmation: confirmation,
      });
    } catch (err) {
      if (err instanceof ShareDeniedError && err.reason === 'NOT_ENTITLED') {
        router.push({ pathname: '/paywall', params: { trigger: 'document_share_export' } });
      } else {
        const copy = shareErrorCopy(err);
        Alert.alert(copy.title, copy.body);
      }
    } finally {
      setBusy(null);
    }
  };

  const share = () => {
    if (!canShare) {
      router.push({ pathname: '/paywall', params: { trigger: 'document_share_export' } });
      return;
    }
    const required = requiredShareConfirmation(doc.sensitivity);
    if (required === 'NONE') {
      void doShare('NONE');
      return;
    }
    const copy = SHARE_CONFIRMATION_COPY[required];
    Alert.alert(copy.title, copy.body, [
      { text: 'Cancel', style: 'cancel' },
      { text: copy.confirm, style: 'destructive', onPress: () => void doShare(required) },
    ]);
  };

  const onReplaceSource = async (outcome: SourceOutcome) => {
    if (outcome.kind === 'canceled') {
      setMode('view');
      return;
    }
    if (outcome.kind !== 'picked') {
      setNotice(
        outcome.kind === 'permission_denied'
          ? 'Camera access was not granted. You can still choose a photo or a file.'
          : 'That file could not be read. Try another photo or file.',
      );
      setMode('view');
      return;
    }
    setBusy('replace');
    try {
      await replaceOperationalDocumentFile(doc.id, outcome.source);
      void syncPendingRoadWallet().catch(() => {});
      setNotice('New version saved. The previous version stays in the history.');
    } catch (err) {
      setNotice(saveErrorCopy(err));
    } finally {
      setBusy(null);
      setMode('view');
    }
  };

  return (
    <Shell
      title={doc.title}
      kicker={documentKindLabel(doc.documentKind)}
      onClose={() => router.back()}
      insets={insets}
    >
      {notice && (
        <Card compact style={styles.noticeCard}>
          <Text style={styles.copy}>{notice}</Text>
        </Card>
      )}

      <View style={styles.pillRow}>
        <Pill label={VALIDITY_LABEL[validity]} tone={VALIDITY_TONE[validity]} />
        <Pill label={READINESS_LABEL[readiness]} tone={READINESS_TONE[readiness]} />
        <Pill
          label={BACKUP_STATE_LABEL[backup]}
          tone={backup === 'backed_up' ? 'green' : 'neutral'}
        />
        {doc.lifecycle === 'ARCHIVED' && <Pill label="Archived" tone="neutral" />}
      </View>

      {mode === 'replace' ? (
        <Card label="Replace document file" style={styles.section}>
          <DocumentSourceSheet
            hint="The new file becomes the current version. The previous version is kept."
            onOutcome={(o) => void onReplaceSource(o)}
          />
          <Button label="Cancel" variant="secondary" onPress={() => setMode('view')} />
        </Card>
      ) : mode === 'edit' ? (
        <EditMetadata
          doc={doc}
          busy={busy === 'save'}
          onCancel={() => setMode('view')}
          onSave={(patch) => {
            setBusy('save');
            try {
              useRoadWalletStore
                .getState()
                .updateDocumentMetadata(doc.id, patch, currentCloudSyncContext());
              void syncPendingRoadWallet().catch(() => {});
              setMode('view');
              setNotice(null);
            } catch (err) {
              setNotice(saveErrorCopy(err));
            } finally {
              setBusy(null);
            }
          }}
        />
      ) : (
        <>
          <FilePreview version={current} />

          <Card label="Details" style={styles.section}>
            <Row label="Applies to" value={doc.subjectKind.toLowerCase()} />
            {doc.issuer && <Row label="Issuer" value={doc.issuer} />}
            {doc.jurisdiction && <Row label="Jurisdiction" value={doc.jurisdiction} />}
            {doc.issuedAt && <Row label="Issued" value={doc.issuedAt} />}
            {doc.effectiveAt && <Row label="Effective" value={doc.effectiveAt} />}
            <Row label="Expires" value={doc.expiresAt ?? VALIDITY_LABEL.NO_EXPIRATION} />
            {doc.maskedReference && <Row label="Reference" value={doc.maskedReference} />}
            {doc.truckId && (
              <Row label="Truck" value={truckLabel ?? 'Unassigned / not on this account'} />
            )}
            {doc.trailerNumber && <Row label="Trailer" value={doc.trailerNumber} />}
            <Row label="Sensitivity" value={SENSITIVITY_LABEL[doc.sensitivity]} last />
            <Text style={styles.disclaimer}>{ROAD_WALLET_DISCLAIMER}</Text>
          </Card>

          <Card label="Actions" style={styles.section}>
            <View style={styles.actions}>
              <Button
                label={
                  busy === 'share'
                    ? 'Preparing…'
                    : canShare
                      ? 'Share / Export'
                      : 'Share / Export (Driver Pro)'
                }
                loading={busy === 'share'}
                disabled={busy !== null || doc.lifecycle === 'ARCHIVED'}
                onPress={share}
              />
              <Button
                label="Edit details"
                variant="secondary"
                disabled={busy !== null}
                onPress={() => setMode('edit')}
              />
              {canRestore && (
                <Button
                  label={busy === 'restore' ? 'Restoring…' : 'Restore to this device'}
                  variant="secondary"
                  loading={busy === 'restore'}
                  disabled={busy !== null}
                  onPress={restore}
                />
              )}
              <Button
                label="Replace document file"
                variant="secondary"
                disabled={busy !== null}
                onPress={() => setMode('replace')}
              />
              <Button
                label={doc.lifecycle === 'ACTIVE' ? 'Archive document' : 'Restore to active'}
                variant="secondary"
                disabled={busy !== null}
                onPress={archiveToggle}
              />
            </View>
            {!canShare && (
              <Text style={styles.hint}>
                Share/Export is part of Driver Pro. Your wallet keeps working on this device either
                way.
              </Text>
            )}
            {backup !== 'backed_up' && userId && !canUseFeature(tier, 'cloudDocumentBackup') && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Learn about cloud document backup"
                onPress={() =>
                  router.push({
                    pathname: '/paywall',
                    params: { trigger: 'cloud_document_backup' },
                  })
                }
              >
                <Text style={styles.link}>Back up your wallet with Driver Pro →</Text>
              </Pressable>
            )}
          </Card>

          <Card
            label="Version history"
            labelRight={`${history.length} ${history.length === 1 ? 'version' : 'versions'}`}
            style={styles.section}
          >
            {history
              .slice()
              .reverse()
              .map((v) => (
                <View
                  key={v.id}
                  style={styles.versionRow}
                  accessibilityLabel={`Version ${v.versionNumber}`}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.versionTitle}>
                      Version {v.versionNumber}
                      {current?.id === v.id ? ' · current' : ''}
                    </Text>
                    <Text style={styles.versionMeta}>
                      {new Date(v.createdAt).toLocaleDateString()} · {fileKindLabel(v)} ·{' '}
                      {formatBytes(v.byteSize)}
                    </Text>
                  </View>
                  <Pill
                    label={
                      v.cloudStatus === 'synced'
                        ? 'Backed up'
                        : v.cloudStatus === 'pending_sync'
                          ? 'Backing up'
                          : 'On this device'
                    }
                    tone={v.cloudStatus === 'synced' ? 'green' : 'neutral'}
                  />
                </View>
              ))}
          </Card>
        </>
      )}
    </Shell>
  );
}

// ---------------------------------------------------------------------------

const VALIDITY_TONE: Record<ReturnType<typeof deriveValidity>, Tone> = {
  NO_EXPIRATION: 'neutral',
  CURRENT: 'green',
  EXPIRING_SOON: 'amber',
  EXPIRED: 'rust',
};

const READINESS_TONE: Record<DocumentVersion['fileCache']['state'], Tone> = {
  NOT_CACHED: 'neutral',
  CACHING: 'neutral',
  READY: 'green',
  ERROR: 'rust',
};

const SENSITIVITY_LABEL = {
  STANDARD: 'Standard',
  PERSONAL_SENSITIVE: 'Personal-sensitive (fixed for this kind)',
  FINANCIAL_SENSITIVE: 'Financial-sensitive',
} as const;

const fileKindLabel = (v: DocumentVersion) =>
  v.fileKind === 'PDF' ? 'PDF' : v.fileKind === 'IMAGE' ? 'Image' : 'File';

const formatBytes = (n: number) =>
  n >= 1_048_576
    ? `${(n / 1_048_576).toFixed(1)} MB`
    : n >= 1024
      ? `${Math.round(n / 1024)} KB`
      : `${n} B`;

/**
 * Image files render only after a current-runtime READY verification; PDFs get
 * a truthful file card (inline PDF rendering and system-open are deferred — C5).
 */
function FilePreview({ version }: { version: DocumentVersion | null }) {
  if (!version) {
    return (
      <Card style={styles.section}>
        <Text style={styles.copy}>No file is stored for this document.</Text>
      </Card>
    );
  }
  const state = version.fileCache.state;
  if (version.fileKind === 'PDF') {
    return (
      <Card label="PDF document" labelRight={formatBytes(version.byteSize)} style={styles.section}>
        <Text style={styles.copy}>
          Stored privately on this device as a PDF. {READINESS_LABEL[state]}.
          {state === 'READY'
            ? ' Use Share / Export to send it to another app.'
            : state === 'ERROR'
              ? ' Replace the document to restore a verified copy.'
              : ''}
        </Text>
        <Text style={styles.hint}>In-app PDF preview is not available yet.</Text>
      </Card>
    );
  }
  if (version.fileKind === 'IMAGE' && state === 'READY') {
    return (
      <Image
        accessibilityLabel="Document image"
        source={{ uri: roadWalletFileStore().uriFor(version.relativePath) }}
        style={styles.image}
        resizeMode="contain"
      />
    );
  }
  return (
    <Card label={version.fileKind === 'IMAGE' ? 'Image document' : 'File'} style={styles.section}>
      <Text style={styles.copy}>
        {state === 'ERROR'
          ? version.fileCache.error === 'MISSING'
            ? 'The stored file is missing on this device. Replace the document to restore a verified copy.'
            : 'The stored file no longer matches the saved version. Replace the document with a fresh photo or file.'
          : 'Checking the stored file…'}
      </Text>
    </Card>
  );
}

function EditMetadata({
  doc,
  busy,
  onCancel,
  onSave,
}: {
  doc: NonNullable<ReturnType<typeof selectDocumentById>>;
  busy: boolean;
  onCancel: () => void;
  onSave: (
    patch: Parameters<ReturnType<typeof useRoadWalletStore.getState>['updateDocumentMetadata']>[1],
  ) => void;
}) {
  const [kind, setKind] = useState<DocumentKind>(doc.documentKind);
  const [title, setTitle] = useState(doc.title);
  const [issuer, setIssuer] = useState(doc.issuer ?? '');
  const [jurisdiction, setJurisdiction] = useState(doc.jurisdiction ?? '');
  const [issuedAt, setIssuedAt] = useState(doc.issuedAt ?? '');
  const [effectiveAt, setEffectiveAt] = useState(doc.effectiveAt ?? '');
  const [expiresAt, setExpiresAt] = useState(doc.expiresAt ?? '');
  const [lastFour, setLastFour] = useState('');
  const [clearReference, setClearReference] = useState(false);

  const bad = (v: string) => (v.trim() && !isIsoDate(v.trim()) ? 'Use YYYY-MM-DD' : null);
  const errors = {
    issuedAt: bad(issuedAt),
    effectiveAt: bad(effectiveAt),
    expiresAt: bad(expiresAt),
  };
  const valid =
    title.trim().length > 0 && !errors.issuedAt && !errors.effectiveAt && !errors.expiresAt;
  const fixed = requiredSensitivityForKind(kind);

  return (
    <Card label="Edit details" style={styles.section}>
      <Text style={styles.fieldLabel}>Document kind</Text>
      <View style={styles.chips}>
        {DOCUMENT_KINDS.map((k) => (
          <Pressable
            key={k}
            accessibilityRole="button"
            accessibilityState={{ selected: k === kind }}
            accessibilityLabel={documentKindLabel(k)}
            onPress={() => setKind(k)}
            style={[styles.chip, k === kind && styles.chipActive]}
          >
            <Text style={[styles.chipLabel, k === kind && styles.chipLabelActive]}>
              {documentKindLabel(k)}
            </Text>
          </Pressable>
        ))}
      </View>
      {fixed && (
        <Text style={styles.hint}>
          This kind is always {SENSITIVITY_LABEL[fixed].toLowerCase()}.
        </Text>
      )}
      <Field label="Title" value={title} onChangeText={setTitle} />
      <Field label="Issuer" value={issuer} onChangeText={setIssuer} />
      <Field label="Jurisdiction" value={jurisdiction} onChangeText={setJurisdiction} />
      <Field
        label="Issued (YYYY-MM-DD)"
        value={issuedAt}
        onChangeText={setIssuedAt}
        error={errors.issuedAt}
      />
      <Field
        label="Effective (YYYY-MM-DD)"
        value={effectiveAt}
        onChangeText={setEffectiveAt}
        error={errors.effectiveAt}
      />
      <Field
        label="Expires (YYYY-MM-DD)"
        value={expiresAt}
        onChangeText={setExpiresAt}
        error={errors.expiresAt}
      />
      <Field
        label={`Last 4 of document number${doc.maskedReference ? ` (currently ${doc.maskedReference})` : ''}`}
        value={lastFour}
        onChangeText={(v) => {
          setClearReference(false);
          setLastFour(v.replace(/[^A-Za-z0-9]/g, '').slice(0, 4));
        }}
        hint="Only a masked form is stored. Leave blank to keep the current value."
        last
      />
      {doc.maskedReference && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Remove reference"
          onPress={() => setClearReference((v) => !v)}
        >
          <Text style={styles.link}>
            {clearReference ? 'Reference will be removed' : 'Remove reference'}
          </Text>
        </Pressable>
      )}
      <View style={styles.actions}>
        <Button
          label={busy ? 'Saving…' : 'Save changes'}
          disabled={!valid || busy}
          loading={busy}
          onPress={() =>
            onSave({
              documentKind: kind,
              // Known-sensitive kinds resolve their fixed class before validation.
              sensitivity: fixed ?? doc.sensitivity,
              title: title.trim(),
              issuer: issuer.trim() || null,
              jurisdiction: jurisdiction.trim() || null,
              issuedAt: issuedAt.trim() || null,
              effectiveAt: effectiveAt.trim() || null,
              expiresAt: expiresAt.trim() || null,
              maskedReference: clearReference
                ? null
                : lastFour
                  ? maskReference(lastFour)
                  : doc.maskedReference,
            })
          }
        />
        <Button label="Cancel" variant="secondary" onPress={onCancel} />
      </View>
    </Card>
  );
}

function Shell({
  title,
  kicker = 'Road Wallet',
  onClose,
  insets,
  children,
}: {
  title: string;
  kicker?: string;
  onClose: () => void;
  insets: { top: number; bottom: number };
  children: React.ReactNode;
}) {
  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <View style={styles.headerRow}>
          <Text style={styles.kicker}>{kicker}</Text>
          <Pressable accessibilityLabel="Close" onPress={onClose} style={styles.closeBtn}>
            <Text style={styles.closeText}>✕</Text>
          </Pressable>
        </View>
        <Text style={styles.title} numberOfLines={2}>
          {title}
        </Text>
      </View>
      <ScrollView
        contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + spacing.xxl * 2 }]}
        keyboardShouldPersistTaps="handled"
      >
        {children}
      </ScrollView>
    </View>
  );
}

function Row({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <View style={[styles.row, last && styles.rowLast]}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

function Field({
  label,
  value,
  onChangeText,
  hint,
  error,
  last,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  hint?: string;
  error?: string | null;
  last?: boolean;
}) {
  return (
    <View style={[styles.field, last && styles.fieldLast]}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChangeText}
        placeholderTextColor="rgba(244,241,232,0.35)"
        autoCapitalize="none"
        autoCorrect={false}
        style={styles.fieldInput}
      />
      {error ? (
        <Text style={styles.fieldError}>{error}</Text>
      ) : hint ? (
        <Text style={styles.hint}>{hint}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: colors.background, flex: 1 },
  header: { paddingHorizontal: spacing.xl },
  headerRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
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
  body: { paddingHorizontal: spacing.xl, paddingTop: spacing.lg },
  section: { marginTop: spacing.md },
  noticeCard: { marginBottom: spacing.md },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  h2: { ...type.h2, color: colors.text },
  copy: { ...type.body, color: colors.textMuted },
  hint: { ...type.bodySmall, color: colors.textFaint, marginTop: spacing.sm },
  link: { ...type.bodySmall, color: colors.action, marginTop: spacing.md },
  disclaimer: { ...type.bodySmall, color: colors.textFaint, marginTop: spacing.md },
  image: {
    backgroundColor: colors.canvasDeep,
    borderColor: colors.border,
    borderRadius: radii.card,
    borderWidth: 1,
    height: 320,
    marginTop: spacing.md,
    width: '100%',
  },
  row: {
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm + 2,
  },
  rowLast: { borderBottomWidth: 0 },
  rowLabel: { ...type.bodySmall, color: colors.textMuted },
  rowValue: { ...type.body, color: colors.text, flexShrink: 1, textAlign: 'right' },
  actions: { gap: spacing.sm },
  versionRow: {
    alignItems: 'center',
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    paddingVertical: spacing.sm + 2,
  },
  versionTitle: { ...type.emphasis, color: colors.text },
  versionMeta: { ...type.bodySmall, color: colors.textMuted, marginTop: 2 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  chip: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: radii.pill,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  chipActive: { backgroundColor: colors.action, borderColor: colors.action },
  chipLabel: { ...type.labelTiny, color: colors.text },
  chipLabelActive: { color: colors.actionInk },
  field: {
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    paddingVertical: spacing.sm + 2,
  },
  fieldLast: { borderBottomWidth: 0 },
  fieldLabel: { ...type.labelTiny, color: colors.textFaint, marginTop: spacing.sm },
  fieldInput: { ...type.body, color: colors.text, paddingVertical: 6 },
  fieldError: { ...type.bodySmall, color: colors.danger, marginTop: 2 },
});
