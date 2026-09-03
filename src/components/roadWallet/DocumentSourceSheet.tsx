import { CameraView, useCameraPermissions } from 'expo-camera';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { ImportSource } from '@/data/documentFiles';
import { colors, fonts, palette, radii, spacing, type } from '@/theme';

/**
 * Picks a TEMPORARY source for a Road Wallet file: camera, photo library, or a
 * file/PDF via expo-document-picker. The returned URI is never stored as
 * canonical — the orchestration copies it into durable private storage.
 * Never routes through the receipt OCR pipeline.
 */
export type SourceOutcome =
  | { kind: 'picked'; source: ImportSource }
  | { kind: 'canceled' }
  | { kind: 'permission_denied' }
  | { kind: 'failed' };

interface DocumentSourceSheetProps {
  onOutcome: (outcome: SourceOutcome) => void;
  /** Copy above the buttons. */
  hint?: string;
}

export function DocumentSourceSheet({ onOutcome, hint }: DocumentSourceSheetProps) {
  const [cameraOpen, setCameraOpen] = useState(false);

  const choosePhoto = async () => {
    try {
      const res = await ImagePicker.launchImageLibraryAsync({ quality: 0.9 });
      if (res.canceled || !res.assets[0]) return onOutcome({ kind: 'canceled' });
      const asset = res.assets[0];
      onOutcome({
        kind: 'picked',
        source: { uri: asset.uri, mimeType: asset.mimeType ?? null, name: asset.fileName ?? null },
      });
    } catch {
      onOutcome({ kind: 'failed' });
    }
  };

  const chooseFile = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf', 'image/*'],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (res.canceled || !res.assets?.[0]) return onOutcome({ kind: 'canceled' });
      const asset = res.assets[0];
      onOutcome({
        kind: 'picked',
        source: { uri: asset.uri, mimeType: asset.mimeType ?? null, name: asset.name ?? null },
      });
    } catch {
      onOutcome({ kind: 'failed' });
    }
  };

  if (cameraOpen) {
    return (
      <RoadWalletCamera
        onCaptured={(uri) => {
          setCameraOpen(false);
          onOutcome({ kind: 'picked', source: { uri, mimeType: 'image/jpeg', name: null } });
        }}
        onCancel={() => {
          setCameraOpen(false);
          onOutcome({ kind: 'canceled' });
        }}
        onDenied={() => {
          setCameraOpen(false);
          onOutcome({ kind: 'permission_denied' });
        }}
      />
    );
  }

  return (
    <View style={styles.sheet}>
      {hint !== undefined && <Text style={styles.hint}>{hint}</Text>}
      <View style={styles.buttons}>
        <Button label="Take Photo" onPress={() => setCameraOpen(true)} />
        <Button label="Choose Photo" variant="secondary" onPress={choosePhoto} />
        <Button label="Choose File / PDF" variant="secondary" onPress={chooseFile} />
      </View>
      <Text style={styles.note}>
        Files are copied into RigReceipts’ private storage on this device. PDFs are stored as PDFs.
      </Text>
    </View>
  );
}

function RoadWalletCamera({
  onCaptured,
  onCancel,
  onDenied,
}: {
  onCaptured: (uri: string) => void;
  onCancel: () => void;
  onDenied: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const [busy, setBusy] = useState(false);

  if (!permission) return <View style={styles.cameraRoot} />;

  if (!permission.granted) {
    return (
      <View
        style={[styles.cameraRoot, styles.permission, { paddingTop: insets.top + spacing.xxl }]}
      >
        <Text style={styles.permissionTitle}>Camera access needed</Text>
        <Text style={styles.permissionCopy}>
          RigReceipts uses the camera only when you take a document photo. Nothing is captured in
          the background.
        </Text>
        <View style={styles.buttons}>
          <Button
            label="Allow Camera"
            onPress={async () => {
              const res = await requestPermission();
              if (!res.granted) onDenied();
            }}
          />
          <Button label="Cancel" variant="secondary" onPress={onCancel} />
        </View>
      </View>
    );
  }

  const shoot = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const photo = await cameraRef.current?.takePictureAsync({ quality: 0.9 });
      if (photo?.uri) onCaptured(photo.uri);
      else onCancel();
    } catch {
      onCancel();
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.cameraRoot}>
      <CameraView ref={cameraRef} style={styles.camera} facing="back" />
      <View style={[styles.cameraControls, { paddingBottom: insets.bottom + spacing.lg }]}>
        <Pressable accessibilityLabel="Cancel photo" onPress={onCancel} style={styles.cameraCancel}>
          <Text style={styles.cameraCancelText}>Cancel</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Take document photo"
          onPress={shoot}
          disabled={busy}
          style={[styles.shutter, busy && styles.shutterBusy]}
        />
        <View style={styles.cameraCancel} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: { gap: spacing.md },
  hint: { ...type.body, color: colors.textMuted },
  buttons: { gap: spacing.sm, marginTop: spacing.sm },
  note: { ...type.bodySmall, color: colors.textFaint },
  cameraRoot: { backgroundColor: colors.canvasDeep, flex: 1, minHeight: 420 },
  camera: { flex: 1, borderRadius: radii.card, overflow: 'hidden' },
  cameraControls: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
  },
  cameraCancel: { minWidth: 72 },
  cameraCancelText: { ...type.body, color: colors.text },
  shutter: {
    backgroundColor: palette.mapIvory,
    borderColor: colors.action,
    borderRadius: 999,
    borderWidth: 4,
    height: 68,
    width: 68,
  },
  shutterBusy: { opacity: 0.5 },
  permission: { gap: spacing.md, paddingHorizontal: spacing.xl },
  permissionTitle: { color: colors.text, fontFamily: fonts.extrabold, fontSize: 20 },
  permissionCopy: { ...type.body, color: colors.textMuted },
});
