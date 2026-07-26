import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Pill } from '@/components';
import { deleteAccount, exportUserData } from '@/data/account';
import { useAuthStore } from '@/store/auth';
import { colors, palette, radii, spacing, type } from '@/theme';

const PRIVACY_URL = 'https://rigreceipts.app/privacy';
const TERMS_URL = 'https://rigreceipts.app/terms';

/**
 * Account & data management (App Store 5.1.1(v) / Google Play): export a full
 * copy of your data and permanently delete your account from inside the app.
 * Deletion is irreversible and routes through the `delete_current_account` RPC.
 */
export default function AccountSettingsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const signedIn = useAuthStore((s) => s.status === 'signed_in');
  const userId = useAuthStore((s) => s.userId);
  const email = useAuthStore((s) => s.session?.user.email ?? null);

  const [busy, setBusy] = useState<'export' | 'delete' | null>(null);

  const onExport = async () => {
    if (!userId) return;
    setBusy('export');
    try {
      const bundle = await exportUserData(userId);
      await Share.share({
        title: 'RigReceipts Data Export',
        message: JSON.stringify(bundle, null, 2),
      });
    } catch {
      Alert.alert(
        'Export failed',
        'We couldn’t build your export. Check your connection and try again.',
      );
    } finally {
      setBusy(null);
    }
  };

  const confirmDelete = () => {
    Alert.alert(
      'Delete your account?',
      'This permanently removes your account and all synced data — loads, receipts, miles, rate checks, and posts. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: onDelete },
      ],
    );
  };

  const onDelete = async () => {
    setBusy('delete');
    try {
      await deleteAccount();
      Alert.alert(
        'Account deleted',
        'Your account and synced data have been removed. You can keep using RigReceipts on this device.',
      );
      router.back();
    } catch {
      Alert.alert(
        'Delete failed',
        'We couldn’t delete your account. Check your connection and try again.',
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <View style={styles.headerRow}>
          <Text style={styles.kicker}>Account</Text>
          <Pressable
            accessibilityLabel="Close"
            onPress={() => router.back()}
            style={styles.closeBtn}
          >
            <Text style={styles.closeText}>✕</Text>
          </Pressable>
        </View>
        <Text style={styles.title}>Account &amp; data</Text>
      </View>

      <ScrollView
        contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + spacing.xxl }]}
      >
        {signedIn ? (
          <>
            <View style={styles.statusCard}>
              <Pill label="Signed in" tone="green" />
              <Text style={styles.email}>{email ?? 'Your account'}</Text>
              <Text style={styles.statusSub}>
                Your records back up to your private space and sync across devices.
              </Text>
            </View>

            <Text style={styles.sectionLabel}>Your data</Text>
            <View style={styles.actionCard}>
              <Text style={styles.actionTitle}>Export my data</Text>
              <Text style={styles.actionCopy}>
                Download a full copy of your loads, receipts, miles, rate checks, and posts as a
                JSON file you can save or share.
              </Text>
              <Button
                label={busy === 'export' ? 'Preparing…' : 'Export My Data'}
                variant="secondary"
                loading={busy === 'export'}
                onPress={onExport}
              />
            </View>

            <Text style={[styles.sectionLabel, styles.danger]}>Danger zone</Text>
            <View style={[styles.actionCard, styles.dangerCard]}>
              <Text style={styles.actionTitle}>Delete my account</Text>
              <Text style={styles.actionCopy}>
                Permanently remove your account and everything synced to it. This can’t be undone —
                export first if you want a copy.
              </Text>
              <Button
                label={busy === 'delete' ? 'Deleting…' : 'Delete Account'}
                variant="danger"
                loading={busy === 'delete'}
                onPress={confirmDelete}
              />
            </View>
          </>
        ) : (
          <View style={styles.statusCard}>
            <Pill label="This device" tone="blue" />
            <Text style={styles.email}>No account</Text>
            <Text style={styles.statusSub}>
              You’re using RigReceipts on this device. Nothing is stored on our servers — your
              records live on this device and are removed when you delete them or uninstall the app.
            </Text>
          </View>
        )}

        <View style={styles.legalRow}>
          <Pressable onPress={() => Linking.openURL(PRIVACY_URL)}>
            <Text style={styles.legalLink}>Privacy Policy</Text>
          </Pressable>
          <Text style={styles.legalDot}>·</Text>
          <Pressable onPress={() => Linking.openURL(TERMS_URL)}>
            <Text style={styles.legalLink}>Terms of Service</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: colors.background, flex: 1 },
  header: { paddingHorizontal: spacing.xl },
  headerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
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
  statusCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.lg,
  },
  email: { ...type.h2, color: colors.text, marginTop: spacing.xs },
  statusSub: { ...type.bodySmall, color: colors.textMuted },
  sectionLabel: {
    ...type.label,
    color: colors.textMuted,
    marginBottom: spacing.sm,
    marginTop: spacing.xl,
  },
  danger: { color: colors.danger },
  actionCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.lg,
  },
  dangerCard: {
    backgroundColor: 'rgba(169, 74, 59, 0.06)',
    borderColor: 'rgba(169, 74, 59, 0.22)',
  },
  actionTitle: { ...type.emphasis, color: colors.text },
  actionCopy: { ...type.bodySmall, color: colors.textMuted },
  legalRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
    marginTop: spacing.xxl,
  },
  legalLink: { ...type.bodySmall, color: palette.highwayBlue },
  legalDot: { color: colors.textMuted },
});
