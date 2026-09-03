import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Card, Pill } from '@/components';
import { DocumentSourceSheet, SourceOutcome } from '@/components/roadWallet/DocumentSourceSheet';
import { saveErrorCopy } from '@/components/roadWallet/errorCopy';
import { RoadWalletGate } from '@/components/roadWallet/RoadWalletGate';
import { ImportSource } from '@/data/documentFiles';
import { syncPendingRoadWallet } from '@/data/documentSync';
import { createOperationalDocumentFromFile } from '@/data/roadWallet';
import { OwnedTruck, useOwnedTrucks } from '@/data/trucks';
import {
  defaultOfflinePinned,
  defaultSensitivityForKind,
  defaultSubjectForKind,
  DOCUMENT_KINDS,
  DocumentKind,
  documentKindLabel,
  isIsoDate,
  maskReference,
  requiredSensitivityForKind,
  resolveFileType,
  SENSITIVITIES,
  Sensitivity,
  SUBJECT_KINDS,
  SubjectKind,
} from '@/domain';
import { useAuthStore } from '@/store/auth';
import { colors, radii, spacing, type } from '@/theme';

/**
 * Add a Road Wallet document: pick a TEMPORARY source (camera / photo / file or
 * PDF), enter minimal metadata, then `createOperationalDocumentFromFile()`
 * copies the file into durable private storage, verifies it and records the
 * immutable version. Never touches the receipt OCR pipeline.
 */
export default function AddRoadDocumentRoute() {
  return (
    <RoadWalletGate>
      <AddRoadDocumentScreen />
    </RoadWalletGate>
  );
}

type Stage = 'source' | 'details' | 'saving';

const SENSITIVITY_LABEL: Record<Sensitivity, string> = {
  STANDARD: 'Standard',
  PERSONAL_SENSITIVE: 'Personal-sensitive',
  FINANCIAL_SENSITIVE: 'Financial-sensitive',
};

const SUBJECT_LABEL: Record<SubjectKind, string> = {
  DRIVER: 'Driver',
  CARRIER: 'Carrier',
  TRUCK: 'Truck',
  TRAILER: 'Trailer',
  GENERAL: 'General',
};

function AddRoadDocumentScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const userId = useAuthStore((s) => s.userId);
  const trucks = useOwnedTrucks(userId);

  const [stage, setStage] = useState<Stage>('source');
  const [source, setSource] = useState<ImportSource | null>(null);
  const [kind, setKind] = useState<DocumentKind>('VEHICLE_REGISTRATION');
  const [title, setTitle] = useState(documentKindLabel('VEHICLE_REGISTRATION'));
  const [titleTouched, setTitleTouched] = useState(false);
  const [subject, setSubject] = useState<SubjectKind>(
    defaultSubjectForKind('VEHICLE_REGISTRATION'),
  );
  const [sensitivity, setSensitivity] = useState<Sensitivity>(
    defaultSensitivityForKind('VEHICLE_REGISTRATION'),
  );
  const [issuer, setIssuer] = useState('');
  const [jurisdiction, setJurisdiction] = useState('');
  const [issuedAt, setIssuedAt] = useState('');
  const [effectiveAt, setEffectiveAt] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [truck, setTruck] = useState<OwnedTruck | null>(null);
  const [trailerNumber, setTrailerNumber] = useState('');
  const [lastFour, setLastFour] = useState('');
  const [error, setError] = useState<string | null>(null);

  const fixedSensitivity = requiredSensitivityForKind(kind);
  const effectiveSensitivity = fixedSensitivity ?? sensitivity;

  const pickKind = (k: DocumentKind) => {
    setKind(k);
    if (!titleTouched) setTitle(documentKindLabel(k));
    setSubject(defaultSubjectForKind(k));
    setSensitivity(defaultSensitivityForKind(k));
  };

  const onSource = (outcome: SourceOutcome) => {
    switch (outcome.kind) {
      case 'picked':
        setSource(outcome.source);
        setStage('details');
        return;
      case 'canceled':
        return;
      case 'permission_denied':
        setError('Camera access was not granted. You can still choose a photo or a file.');
        return;
      case 'failed':
        setError('That file could not be read. Try another photo or file.');
        return;
      default: {
        const exhaustive: never = outcome;
        return exhaustive;
      }
    }
  };

  const dateError = (v: string) => (v.trim() && !isIsoDate(v.trim()) ? 'Use YYYY-MM-DD' : null);
  const dateErrors = {
    issuedAt: dateError(issuedAt),
    effectiveAt: dateError(effectiveAt),
    expiresAt: dateError(expiresAt),
  };
  const canSave =
    !!source &&
    title.trim().length > 0 &&
    !dateErrors.issuedAt &&
    !dateErrors.effectiveAt &&
    !dateErrors.expiresAt;

  const save = async () => {
    if (!source || !canSave) return;
    setStage('saving');
    setError(null);
    try {
      const { document } = await createOperationalDocumentFromFile(source, {
        documentKind: kind,
        title: title.trim(),
        subjectKind: subject,
        sensitivity: effectiveSensitivity,
        offlinePinned: defaultOfflinePinned(effectiveSensitivity),
        truck: truck ? { id: truck.id, ownerId: truck.ownerId } : null,
        trailerNumber: trailerNumber.trim() || null,
        issuer: issuer.trim() || null,
        jurisdiction: jurisdiction.trim() || null,
        issuedAt: issuedAt.trim() || null,
        effectiveAt: effectiveAt.trim() || null,
        expiresAt: expiresAt.trim() || null,
        // Only the masked form is ever built or stored; raw input is discarded.
        maskedReference: maskReference(lastFour),
      });
      setLastFour('');
      // Best-effort backup for entitled accounts; a Free/local-only document simply stays local.
      void syncPendingRoadWallet().catch(() => {});
      router.replace({ pathname: '/document-detail', params: { id: document.id } });
    } catch (err) {
      setStage('details');
      setError(saveErrorCopy(err));
    }
  };

  const sourceType = source ? resolveFileType(source) : null;

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <View style={styles.headerRow}>
          <Text style={styles.kicker}>Road Wallet</Text>
          <Pressable
            accessibilityLabel="Close"
            onPress={() => router.back()}
            style={styles.closeBtn}
          >
            <Text style={styles.closeText}>✕</Text>
          </Pressable>
        </View>
        <Text style={styles.title}>Add a document</Text>
      </View>

      <ScrollView
        contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + spacing.xxl * 2 }]}
        keyboardShouldPersistTaps="handled"
      >
        {error && (
          <Card compact style={styles.errorCard}>
            <Text style={styles.errorText}>{error}</Text>
          </Card>
        )}

        {stage === 'source' && (
          <Card label="Step 1" labelRight="Choose the file">
            <DocumentSourceSheet
              hint="Photograph the document, pick a photo, or choose a PDF or image file."
              onOutcome={onSource}
            />
          </Card>
        )}

        {(stage === 'details' || stage === 'saving') && sourceType && (
          <>
            <Card
              label="File"
              labelRight={
                sourceType.kind === 'PDF' ? 'PDF' : sourceType.kind === 'IMAGE' ? 'Image' : 'File'
              }
            >
              <Text style={styles.fileCopy}>
                {sourceType.kind === 'PDF'
                  ? 'PDF selected. It will be stored as a PDF; sharing is available to Driver Pro and above.'
                  : sourceType.kind === 'IMAGE'
                    ? 'Image selected. It will be copied into private storage and verified before saving.'
                    : 'File selected. It will be stored privately as-is.'}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Choose a different file"
                onPress={() => {
                  setSource(null);
                  setStage('source');
                }}
              >
                <Text style={styles.link}>Choose a different file</Text>
              </Pressable>
            </Card>

            <Card label="Document kind" style={styles.section}>
              <View style={styles.chips}>
                {DOCUMENT_KINDS.map((k) => (
                  <Chip
                    key={k}
                    label={documentKindLabel(k)}
                    active={k === kind}
                    onPress={() => pickKind(k)}
                  />
                ))}
              </View>
              <Text style={styles.sensitivityNote}>
                Sensitivity:{' '}
                <Text style={styles.emphasis}>{SENSITIVITY_LABEL[effectiveSensitivity]}</Text>
                {fixedSensitivity
                  ? ' — fixed for this kind of document.'
                  : ' — you can change this below.'}
              </Text>
              {!fixedSensitivity && (
                <View style={styles.chips}>
                  {SENSITIVITIES.map((s) => (
                    <Chip
                      key={s}
                      label={SENSITIVITY_LABEL[s]}
                      active={s === sensitivity}
                      onPress={() => setSensitivity(s)}
                    />
                  ))}
                </View>
              )}
            </Card>

            <Card label="Details" style={styles.section}>
              <Field
                label="Title"
                value={title}
                onChangeText={(v) => {
                  setTitleTouched(true);
                  setTitle(v);
                }}
                placeholder={documentKindLabel(kind)}
              />
              <Text style={styles.fieldLabel}>Applies to</Text>
              <View style={styles.chips}>
                {SUBJECT_KINDS.map((s) => (
                  <Chip
                    key={s}
                    label={SUBJECT_LABEL[s]}
                    active={s === subject}
                    onPress={() => setSubject(s)}
                  />
                ))}
              </View>
              <Field
                label="Issuer (optional)"
                value={issuer}
                onChangeText={setIssuer}
                placeholder="Who issued it"
              />
              <Field
                label="Jurisdiction (optional)"
                value={jurisdiction}
                onChangeText={setJurisdiction}
                placeholder="State / agency"
              />
              <Field
                label="Issued (YYYY-MM-DD, optional)"
                value={issuedAt}
                onChangeText={setIssuedAt}
                placeholder="2026-01-15"
                error={dateErrors.issuedAt}
              />
              <Field
                label="Effective (YYYY-MM-DD, optional)"
                value={effectiveAt}
                onChangeText={setEffectiveAt}
                placeholder="2026-01-15"
                error={dateErrors.effectiveAt}
              />
              <Field
                label="Expires (YYYY-MM-DD, optional)"
                value={expiresAt}
                onChangeText={setExpiresAt}
                placeholder="2027-01-15"
                error={dateErrors.expiresAt}
              />
              <Field
                label="Last 4 of document number (optional)"
                value={lastFour}
                onChangeText={(v) => setLastFour(v.replace(/[^A-Za-z0-9]/g, '').slice(0, 4))}
                placeholder="1234"
                hint="Only a masked form (****1234) is stored. Never enter a full number."
                last
              />
            </Card>

            {(subject === 'TRUCK' || subject === 'TRAILER') && (
              <Card label="Unit" style={styles.section}>
                {subject === 'TRUCK' && (
                  <>
                    <Text style={styles.fieldLabel}>Truck</Text>
                    {userId ? (
                      trucks.data && trucks.data.length > 0 ? (
                        <View style={styles.chips}>
                          <Chip
                            label="None"
                            active={truck === null}
                            onPress={() => setTruck(null)}
                          />
                          {trucks.data.map((t) => (
                            <Chip
                              key={t.id}
                              label={t.unitName}
                              active={truck?.id === t.id}
                              onPress={() => setTruck(t)}
                            />
                          ))}
                        </View>
                      ) : (
                        <Text style={styles.hint}>
                          No trucks on your account yet. You can save without a truck.
                        </Text>
                      )
                    ) : (
                      <Text style={styles.hint}>
                        Truck records need an account. On this device the document is saved without
                        a truck link.
                      </Text>
                    )}
                  </>
                )}
                {subject === 'TRAILER' && (
                  <Field
                    label="Trailer number (optional)"
                    value={trailerNumber}
                    onChangeText={setTrailerNumber}
                    placeholder="Unit or trailer number"
                    last
                  />
                )}
              </Card>
            )}

            <View style={styles.actions}>
              <Button
                label={stage === 'saving' ? 'Saving…' : 'Save to Road Wallet'}
                disabled={!canSave || stage === 'saving'}
                loading={stage === 'saving'}
                onPress={save}
              />
              <Pill
                label={
                  userId ? 'Saved to this device · backup per your plan' : 'Saved to this device'
                }
                tone="neutral"
              />
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={label}
      onPress={onPress}
      style={[styles.chip, active && styles.chipActive]}
    >
      <Text style={[styles.chipLabel, active && styles.chipLabelActive]}>{label}</Text>
    </Pressable>
  );
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  hint,
  error,
  last,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
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
        placeholder={placeholder}
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
  errorCard: {
    backgroundColor: 'rgba(169, 74, 59, 0.08)',
    borderColor: 'rgba(169, 74, 59, 0.3)',
    marginBottom: spacing.md,
  },
  errorText: { ...type.bodySmall, color: colors.text },
  fileCopy: { ...type.body, color: colors.textMuted },
  link: { ...type.bodySmall, color: colors.action, marginTop: spacing.sm },
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
  sensitivityNote: { ...type.bodySmall, color: colors.textMuted, marginTop: spacing.md },
  emphasis: { color: colors.text },
  field: {
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    paddingVertical: spacing.sm + 2,
  },
  fieldLast: { borderBottomWidth: 0 },
  fieldLabel: { ...type.labelTiny, color: colors.textFaint, marginTop: spacing.sm },
  fieldInput: { ...type.body, color: colors.text, paddingVertical: 6 },
  fieldError: { ...type.bodySmall, color: colors.danger, marginTop: 2 },
  hint: { ...type.bodySmall, color: colors.textFaint, marginTop: 4 },
  actions: { gap: spacing.md, marginTop: spacing.xl },
});
