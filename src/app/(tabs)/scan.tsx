import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Card, Pill, RouteBand, Screen } from '@/components';
import { createCapture } from '@/data/captureSync';
import { CaptureSyncStatus, SCAN_TYPES, ScanTypeSlug } from '@/domain';
import { OcrEngineName, parseReceipt, recognizeDocument } from '@/ocr';
import { useAuthStore } from '@/store/auth';
import { useCapturesStore } from '@/store/captures';
import { colors, palette, radii, spacing, type } from '@/theme';

type Stage = 'picker' | 'camera' | 'processing' | 'review' | 'saved';

interface Draft {
  scanType: ScanTypeSlug;
  imageUri: string | null;
  engine: OcrEngineName;
  rawText: string;
  vendor: string;
  total: string;
  date: string;
  gallons: string;
}

/**
 * Scan & capture (Loop 3 / Phase 6 spike). Camera → on-device OCR → editable
 * review → save to the offline queue. OCR is never trusted silently: the review
 * sheet always requires a confirm before a record is created.
 */
export default function ScanScreen() {
  const [stage, setStage] = useState<Stage>('picker');
  const [scanType, setScanType] = useState<ScanTypeSlug>('receipt');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [savedStatus, setSavedStatus] = useState<CaptureSyncStatus>('local_only');
  const signedIn = useAuthStore((s) => s.status === 'signed_in');

  const runOcr = async (imageUri: string | null, forceStub: boolean) => {
    setStage('processing');
    const ocr = await recognizeDocument(imageUri ?? '', { forceStub, stubType: scanType });
    const parsed = parseReceipt(ocr.text);
    setDraft({
      scanType,
      imageUri,
      engine: ocr.engine,
      rawText: ocr.text,
      vendor: parsed.vendor ?? '',
      total: parsed.totalUsd !== null ? String(parsed.totalUsd) : '',
      date: parsed.date ?? '',
      gallons: parsed.gallons !== null ? String(parsed.gallons) : '',
    });
    setStage('review');
  };

  const reset = () => {
    setDraft(null);
    setStage('picker');
  };

  if (stage === 'camera') {
    return (
      <CameraCapture onCaptured={(uri) => runOcr(uri, false)} onCancel={() => setStage('picker')} />
    );
  }

  return (
    <Screen
      dark
      kicker="Field Capture"
      title="Scan anything from the road."
      headerRight={<Pill label={`${SCAN_TYPES.length} types`} tone="green" />}
    >
      {stage === 'picker' && (
        <Picker
          scanType={scanType}
          onPick={setScanType}
          onOpenCamera={() => setStage('camera')}
          onChoosePhoto={async () => {
            const res = await ImagePicker.launchImageLibraryAsync({ quality: 0.7 });
            if (!res.canceled && res.assets[0]) runOcr(res.assets[0].uri, false);
          }}
          onUseSample={() => runOcr(null, true)}
        />
      )}

      {stage === 'processing' && (
        <View style={styles.processing}>
          <ActivityIndicator color={palette.routeGreen2} />
          <Text style={styles.processingCopy}>Reading the document…</Text>
        </View>
      )}

      {stage === 'review' && draft && (
        <ReviewSheet
          draft={draft}
          onChange={setDraft}
          onSaved={(status) => {
            setSavedStatus(status);
            setStage('saved');
          }}
          onCancel={reset}
        />
      )}

      {stage === 'saved' && (
        <SavedConfirm onAnother={reset} signedIn={signedIn} status={savedStatus} />
      )}
    </Screen>
  );
}

// ---------------------------------------------------------------------------

function Picker({
  scanType,
  onPick,
  onOpenCamera,
  onChoosePhoto,
  onUseSample,
}: {
  scanType: ScanTypeSlug;
  onPick: (t: ScanTypeSlug) => void;
  onOpenCamera: () => void;
  onChoosePhoto: () => void;
  onUseSample: () => void;
}) {
  return (
    <>
      <View style={styles.chips}>
        {SCAN_TYPES.map((t) => {
          const active = t.slug === scanType;
          return (
            <Pressable
              key={t.slug}
              onPress={() => onPick(t.slug)}
              style={[styles.chip, active && styles.chipActive]}
            >
              <Text style={[styles.chipLabel, active && styles.chipLabelActive]}>{t.label}</Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.captureBtns}>
        <Button label="Open Camera" onPress={onOpenCamera} />
        <Button label="Choose Photo" variant="secondary" dark onPress={onChoosePhoto} />
      </View>

      <RouteBand
        dark
        marker="✓"
        markerTone="green"
        title="On-device OCR"
        subtitle="Text is read on your phone. You confirm every field before it saves."
        value="Private"
      />
      <Pressable onPress={onUseSample} style={styles.sampleLink}>
        <Text style={styles.sampleLinkText}>No camera here? Use a sample document →</Text>
      </Pressable>
    </>
  );
}

// ---------------------------------------------------------------------------

function CameraCapture({
  onCaptured,
  onCancel,
}: {
  onCaptured: (uri: string) => void;
  onCancel: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const [busy, setBusy] = useState(false);

  if (!permission) {
    return <View style={styles.cameraRoot} />;
  }

  if (!permission.granted) {
    return (
      <View
        style={[styles.cameraRoot, styles.permission, { paddingTop: insets.top + spacing.xxl }]}
      >
        <Text style={styles.permTitle}>Camera access</Text>
        <Text style={styles.permCopy}>
          RigReceipts uses the camera to scan receipts and load documents. It opens only here, when
          you scan.
        </Text>
        <View style={styles.permButtons}>
          <Button label="Allow Camera" onPress={requestPermission} />
          <Button label="Back" variant="secondary" dark onPress={onCancel} />
        </View>
      </View>
    );
  }

  const shoot = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const photo = await cameraRef.current?.takePictureAsync({ quality: 0.7 });
      if (photo?.uri) onCaptured(photo.uri);
      else onCancel();
    } catch {
      onCancel();
    }
  };

  return (
    <View style={styles.cameraRoot}>
      <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="back" />
      <View style={styles.frameOverlay} pointerEvents="none">
        <View style={[styles.frameCorner, styles.tl]} />
        <View style={[styles.frameCorner, styles.tr]} />
        <View style={[styles.frameCorner, styles.bl]} />
        <View style={[styles.frameCorner, styles.br]} />
      </View>
      <View style={[styles.cameraBar, { paddingBottom: insets.bottom + spacing.xl }]}>
        <Pressable accessibilityLabel="Cancel" onPress={onCancel} style={styles.cameraCancel}>
          <Text style={styles.cameraCancelText}>Cancel</Text>
        </Pressable>
        <Pressable accessibilityLabel="Capture" onPress={shoot} style={styles.shutter}>
          {busy ? (
            <ActivityIndicator color={palette.asphaltCharcoal} />
          ) : (
            <View style={styles.shutterInner} />
          )}
        </Pressable>
        <View style={styles.cameraCancel} />
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------

function ReviewSheet({
  draft,
  onChange,
  onSaved,
  onCancel,
}: {
  draft: Draft;
  onChange: (d: Draft) => void;
  onSaved: (status: CaptureSyncStatus) => void;
  onCancel: () => void;
}) {
  const isFuel = draft.scanType === 'fuel' || draft.gallons !== '';

  const save = () => {
    // Owner binding, initial sync state and any immediate upload are decided
    // by the cloud-sync boundary, never by this screen.
    const id = createCapture({
      scanType: draft.scanType,
      imageUri: draft.imageUri,
      engine: draft.engine,
      rawText: draft.rawText,
      vendor: draft.vendor.trim() || null,
      totalUsd: draft.total ? Number(draft.total) : null,
      date: draft.date.trim() || null,
      gallons: draft.gallons ? Number(draft.gallons) : null,
    });
    const saved = useCapturesStore.getState().captures.find((c) => c.id === id);
    onSaved(saved?.status ?? 'local_only');
  };

  return (
    <>
      <View style={styles.reviewHead}>
        <Pill
          label={draft.engine === 'stub' ? 'Sample OCR' : 'On-device OCR'}
          tone={draft.engine === 'stub' ? 'amber' : 'green'}
        />
        <Text style={styles.reviewNote}>Check these before saving.</Text>
      </View>

      <Card dark label="Document" labelRight={labelFor(draft.scanType)}>
        <Field
          label="Vendor"
          value={draft.vendor}
          onChangeText={(v) => onChange({ ...draft, vendor: v })}
          placeholder="Who was paid"
        />
        <Field
          label="Amount ($)"
          value={draft.total}
          onChangeText={(v) => onChange({ ...draft, total: v.replace(/[^0-9.]/g, '') })}
          keyboardType="decimal-pad"
          placeholder="0.00"
        />
        <Field
          label="Date"
          value={draft.date}
          onChangeText={(v) => onChange({ ...draft, date: v })}
          placeholder="YYYY-MM-DD"
        />
        {isFuel && (
          <Field
            label="Gallons"
            value={draft.gallons}
            onChangeText={(v) => onChange({ ...draft, gallons: v.replace(/[^0-9.]/g, '') })}
            keyboardType="decimal-pad"
            placeholder="0"
            last
          />
        )}
      </Card>

      <View style={styles.reviewActions}>
        <Button label="Confirm & Save" onPress={save} />
        <Button label="Discard" variant="secondary" dark onPress={onCancel} />
      </View>
    </>
  );
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  last,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  keyboardType?: 'decimal-pad';
  last?: boolean;
}) {
  return (
    <View style={[styles.field, last && styles.fieldLast]}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="rgba(244,241,232,0.35)"
        keyboardType={keyboardType}
        style={styles.fieldInput}
      />
    </View>
  );
}

/** Post-save copy reflects the capture's real sync state, not just sign-in. */
function savedCopy(
  status: CaptureSyncStatus,
  signedIn: boolean,
): { label: string; title: string; body: string } {
  switch (status) {
    case 'synced':
    case 'pending_sync':
      return {
        label: 'Backing up',
        title: 'Filed and backing up.',
        body: 'Saved on this device and syncing to your account — nothing is lost if you close the app.',
      };
    case 'local_only':
      return signedIn
        ? {
            label: 'On this device',
            title: 'Filed to your device.',
            body: 'Stored on this device. Cloud backup is part of Driver Pro — nothing is lost if you close the app.',
          }
        : {
            label: 'On this device',
            title: 'Filed to your device.',
            body: 'Stored on this device. Sign in from onboarding to back it up — nothing is lost if you close the app.',
          };
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}

function SavedConfirm({
  onAnother,
  signedIn,
  status,
}: {
  onAnother: () => void;
  signedIn: boolean;
  status: CaptureSyncStatus;
}) {
  const copy = savedCopy(status, signedIn);
  return (
    <>
      <Card dark label="Saved" labelRight={copy.label}>
        <Text style={styles.savedTitle}>{copy.title}</Text>
        <Text style={styles.savedCopy}>{copy.body}</Text>
      </Card>
      <View style={{ marginTop: spacing.lg }}>
        <Button label="Scan Another" onPress={onAnother} />
      </View>
    </>
  );
}

const labelFor = (slug: ScanTypeSlug) => SCAN_TYPES.find((t) => t.slug === slug)?.label ?? slug;

const styles = StyleSheet.create({
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  chip: {
    backgroundColor: 'rgba(244, 241, 232, 0.08)',
    borderColor: 'rgba(244, 241, 232, 0.10)',
    borderRadius: radii.pill,
    borderWidth: 1,
    paddingHorizontal: 11,
    paddingVertical: 8,
  },
  chipActive: {
    backgroundColor: palette.routeGreen,
    borderColor: palette.routeGreen,
  },
  chipLabel: {
    color: 'rgba(244, 241, 232, 0.72)',
    fontFamily: type.emphasis.fontFamily,
    fontSize: 11,
  },
  chipLabelActive: {
    color: palette.mapIvory,
  },
  captureBtns: {
    gap: spacing.sm + 2,
    marginTop: spacing.xl,
    marginBottom: spacing.md,
  },
  sampleLink: {
    marginTop: spacing.lg,
    paddingVertical: spacing.sm,
  },
  sampleLinkText: {
    ...type.bodySmall,
    color: 'rgba(244, 241, 232, 0.6)',
    textAlign: 'center',
  },
  // processing
  processing: {
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.xxl * 2,
  },
  processingCopy: {
    ...type.body,
    color: 'rgba(244, 241, 232, 0.7)',
  },
  // camera
  cameraRoot: {
    backgroundColor: palette.asphalt2,
    flex: 1,
  },
  permission: {
    paddingHorizontal: spacing.xl,
  },
  permTitle: {
    ...type.h1,
    color: colors.textOnDark,
  },
  permCopy: {
    ...type.body,
    color: 'rgba(244, 241, 232, 0.7)',
    marginTop: spacing.md,
  },
  permButtons: {
    gap: spacing.sm + 2,
    marginTop: spacing.xl,
  },
  frameOverlay: {
    bottom: 0,
    left: 0,
    margin: spacing.xxl,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  frameCorner: {
    borderColor: palette.routeGreen2,
    height: 48,
    position: 'absolute',
    width: 48,
  },
  tl: { borderLeftWidth: 3, borderTopLeftRadius: radii.sm, borderTopWidth: 3, left: 0, top: 60 },
  tr: { borderRightWidth: 3, borderTopRightRadius: radii.sm, borderTopWidth: 3, right: 0, top: 60 },
  bl: {
    borderBottomLeftRadius: radii.sm,
    borderBottomWidth: 3,
    borderLeftWidth: 3,
    bottom: 60,
    left: 0,
  },
  br: {
    borderBottomRightRadius: radii.sm,
    borderBottomWidth: 3,
    borderRightWidth: 3,
    bottom: 60,
    right: 0,
  },
  cameraBar: {
    alignItems: 'center',
    bottom: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    left: 0,
    paddingHorizontal: spacing.xl,
    position: 'absolute',
    right: 0,
  },
  cameraCancel: {
    width: 70,
  },
  cameraCancelText: {
    ...type.emphasis,
    color: colors.textOnDark,
  },
  shutter: {
    alignItems: 'center',
    backgroundColor: palette.mapIvory,
    borderRadius: 36,
    height: 72,
    justifyContent: 'center',
    width: 72,
  },
  shutterInner: {
    backgroundColor: palette.mapIvory,
    borderColor: palette.asphaltCharcoal,
    borderRadius: 28,
    borderWidth: 3,
    height: 56,
    width: 56,
  },
  // review
  reviewHead: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  reviewNote: {
    ...type.bodySmall,
    color: 'rgba(244, 241, 232, 0.62)',
  },
  field: {
    borderBottomColor: 'rgba(244, 241, 232, 0.12)',
    borderBottomWidth: 1,
    paddingVertical: spacing.md,
  },
  fieldLast: {
    borderBottomWidth: 0,
  },
  fieldLabel: {
    ...type.labelTiny,
    color: 'rgba(244, 241, 232, 0.55)',
    marginBottom: 6,
  },
  fieldInput: {
    color: colors.textOnDark,
    fontFamily: type.emphasis.fontFamily,
    fontSize: 16,
    padding: 0,
  },
  reviewActions: {
    gap: spacing.sm + 2,
    marginTop: spacing.lg,
  },
  savedTitle: {
    ...type.h2,
    color: colors.textOnDark,
    marginBottom: spacing.sm,
  },
  savedCopy: {
    ...type.body,
    color: 'rgba(244, 241, 232, 0.7)',
  },
});
