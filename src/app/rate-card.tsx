import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Share, StyleSheet, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { track } from '@/analytics';
import { Button, Pill, RateCardView } from '@/components';
import { isFeatureEnabled } from '@/config/flags';
import {
  equipmentLabel,
  isEligibleForPublicBoard,
  RateCardSource,
  RateCardVisibility,
  SafeRateCard,
  sanitizeRateShareCard,
} from '@/domain';
import { useRateCardStore } from '@/store/rateCard';
import { colors, palette, radii, spacing, type } from '@/theme';

type Step = 'intro' | 'preview' | 'share';

const TOGGLES: { key: keyof RateCardVisibility; label: string }[] = [
  { key: 'showGrossRate', label: 'Show Gross Rate' },
  { key: 'showLoadedMiles', label: 'Show Loaded Miles' },
  { key: 'showDeadhead', label: 'Show Deadhead' },
  { key: 'showLoadedRpm', label: 'Show Loaded RPM' },
  { key: 'showAllMileRpm', label: 'Show All-Mile RPM' },
  { key: 'showApproxDate', label: 'Show Approximate Load Date' },
];

// Section 7 — the categories RigReceipts strips before any card is shared.
const EXCLUDED = [
  'Driver, carrier, truck & trailer numbers',
  'Load number, BOL & POD numbers',
  'Exact pickup / delivery addresses & times',
  'Shipper, receiver, customer & broker contacts',
  'Phone, email, bank & payment details',
  'Rate-confirmation image & document notes',
];

/** Rate Sharing Card flow (Sections 4–9). Gated by rate_sharing_cards_enabled. */
export default function RateCardModal() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const source = useRateCardStore((s) => s.source);
  const visibility = useRateCardStore((s) => s.visibility);
  const setVisibility = useRateCardStore((s) => s.setVisibility);
  const [step, setStep] = useState<Step>('intro');

  const safeCard = useMemo(
    () => (source ? sanitizeRateShareCard(source, visibility, false) : null),
    [source, visibility],
  );

  useEffect(() => {
    if (step === 'preview') track('rate_card_previewed', {});
  }, [step]);

  const close = () => router.back();

  if (!source || !safeCard) {
    return (
      <View style={[styles.root, styles.center]}>
        <Text style={styles.body}>No card to share.</Text>
        <View style={{ marginTop: spacing.lg }}>
          <Button label="Close" onPress={close} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <Text style={styles.headerTitle}>Rate Card</Text>
        <Pressable accessibilityLabel="Close" onPress={close} style={styles.closeBtn}>
          <Text style={styles.closeText}>✕</Text>
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + spacing.xxl }]}
      >
        {step === 'intro' && (
          <>
            <Pill label="Privacy-safe" tone="green" />
            <Text style={styles.title}>Share the rate — not your paperwork.</Text>
            <Text style={styles.copy}>
              RigReceipts creates a privacy-safe rate card without showing your name, load number,
              exact addresses, contacts, or documents.
            </Text>
            <View style={styles.footerInline}>
              <Button label="Preview My Card" onPress={() => setStep('preview')} />
              <Button label="Not Now" variant="secondary" onPress={close} />
            </View>
          </>
        )}

        {step === 'preview' && (
          <>
            <RateCardView card={safeCard} />

            <Text style={styles.sectionLabel}>Choose what appears on your card</Text>
            <View style={styles.toggleCard}>
              {TOGGLES.map((t, i) => (
                <View
                  key={t.key}
                  style={[styles.toggleRow, i === TOGGLES.length - 1 && styles.toggleRowLast]}
                >
                  <Text style={styles.toggleLabel}>{t.label}</Text>
                  <Switch
                    value={visibility[t.key]}
                    onValueChange={(v) => setVisibility({ [t.key]: v })}
                    trackColor={{ true: palette.routeGreen, false: '#c9c5bc' }}
                  />
                </View>
              ))}
            </View>

            <Text style={styles.required}>
              Always shown: origin & destination metro, equipment, and rate status.
            </Text>

            <View style={styles.noticeCard}>
              <Text style={styles.noticeTitle}>What RigReceipts removes</Text>
              <Text style={styles.noticeBody}>
                Shipment, customer, contact, and document information is removed before a rate card
                is shared. Review the card before publishing.
              </Text>
              {EXCLUDED.map((line) => (
                <Text key={line} style={styles.excluded}>
                  · {line}
                </Text>
              ))}
            </View>

            <View style={styles.footerInline}>
              <Button label="Continue" onPress={() => setStep('share')} />
              <Button label="Back" variant="secondary" onPress={() => setStep('intro')} />
            </View>
          </>
        )}

        {step === 'share' && <ShareStep card={safeCard} source={source} onDone={close} />}
      </ScrollView>
    </View>
  );
}

function ShareStep({
  card,
  source,
  onDone,
}: {
  card: SafeRateCard;
  source: RateCardSource;
  onDone: () => void;
}) {
  const postingEnabled = isFeatureEnabled('community_rate_posting_enabled');
  const eligibleToPost = isEligibleForPublicBoard(source.verificationLevel);
  const canPost = postingEnabled && eligibleToPost;

  const shareExternally = async () => {
    track('rate_card_external_share_started', {});
    const lines = [
      `${card.originMetro.toUpperCase()}, ${card.originState} → ${card.destinationMetro.toUpperCase()}, ${card.destinationState}`,
      `${equipmentLabel(card.equipmentType)} · ${card.rateStatus}`,
      card.grossRate !== null ? `Gross: $${Math.round(card.grossRate).toLocaleString()}` : null,
      card.allMileRpm !== null ? `All-Mile RPM: $${card.allMileRpm.toFixed(2)}` : null,
      'Historical rate via RigReceipts. Not an available load.',
    ].filter(Boolean);
    const deepLink = `rigreceipts://rate?o=${encodeURIComponent(
      `${card.originMetro},${card.originState}`,
    )}&d=${encodeURIComponent(`${card.destinationMetro},${card.destinationState}`)}&e=${card.equipmentType}`;
    try {
      await Share.share({ message: `${lines.join('\n')}\n${deepLink}` });
      track('rate_card_external_share_completed', {});
    } catch {
      // user dismissed or share unavailable — no-op
    }
    onDone();
  };

  return (
    <>
      <Text style={styles.title}>What would you like to do?</Text>

      <ShareOption
        title="Keep Private"
        copy="Save the card to this load without sharing it."
        tone="neutral"
        onPress={onDone}
      />
      <ShareOption
        title="Share Outside RigReceipts"
        copy="Use your phone’s share menu to send or post the card."
        tone="blue"
        onPress={shareExternally}
      />
      <ShareOption
        title="Post to Community Rate Board"
        copy={
          !eligibleToPost
            ? 'Self-entered rates can’t be posted publicly yet — verify with a document or completed load.'
            : !postingEnabled
              ? 'Community posting opens in a controlled beta.'
              : 'Share this historical rate anonymously with the RigReceipts community.'
        }
        tone="green"
        disabled={!canPost}
        onPress={() => {
          track('rate_board_post_started', {});
          // The first-public-post flow + moderation land in Phase D.
          onDone();
        }}
      />

      <Text style={styles.required}>No card is posted publicly without your explicit action.</Text>
    </>
  );
}

function ShareOption({
  title,
  copy,
  tone,
  onPress,
  disabled,
}: {
  title: string;
  copy: string;
  tone: 'green' | 'blue' | 'neutral';
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.option,
        tone === 'green' && styles.optionGreen,
        tone === 'blue' && styles.optionBlue,
        disabled && styles.optionDisabled,
        pressed && !disabled && styles.pressed,
      ]}
    >
      <Text style={styles.optionTitle}>{title}</Text>
      <Text style={styles.optionCopy}>{copy}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    backgroundColor: colors.background,
    flex: 1,
  },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.xl,
  },
  headerTitle: {
    ...type.label,
    color: colors.textMuted,
  },
  closeBtn: {
    alignItems: 'center',
    backgroundColor: 'rgba(30, 35, 39, 0.06)',
    borderRadius: radii.sm,
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  closeText: {
    color: colors.text,
    fontSize: 15,
  },
  body: {
    paddingHorizontal: spacing.xl,
  },
  title: {
    ...type.h1,
    color: colors.text,
    marginTop: spacing.md,
  },
  copy: {
    ...type.body,
    color: colors.textMuted,
    marginTop: spacing.md,
  },
  footerInline: {
    gap: spacing.sm + 2,
    marginTop: spacing.xl,
  },
  sectionLabel: {
    ...type.label,
    color: colors.textMuted,
    marginBottom: spacing.sm,
    marginTop: spacing.xl,
  },
  toggleCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    paddingHorizontal: spacing.lg,
  },
  toggleRow: {
    alignItems: 'center',
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
  },
  toggleRowLast: {
    borderBottomWidth: 0,
  },
  toggleLabel: {
    ...type.body,
    color: colors.text,
  },
  required: {
    ...type.bodySmall,
    color: colors.textMuted,
    marginTop: spacing.md,
  },
  noticeCard: {
    backgroundColor: 'rgba(200, 145, 45, 0.08)',
    borderColor: 'rgba(200, 145, 45, 0.22)',
    borderRadius: radii.md,
    borderWidth: 1,
    marginTop: spacing.lg,
    padding: spacing.lg,
  },
  noticeTitle: {
    ...type.emphasis,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  noticeBody: {
    ...type.bodySmall,
    color: colors.textMuted,
    marginBottom: spacing.sm,
  },
  excluded: {
    ...type.bodySmall,
    color: colors.textMuted,
    marginTop: 2,
  },
  option: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderLeftWidth: 4,
    borderRadius: radii.md,
    borderWidth: 1,
    marginTop: spacing.md,
    padding: spacing.lg,
  },
  optionGreen: {
    borderLeftColor: palette.routeGreen,
  },
  optionBlue: {
    borderLeftColor: palette.highwayBlue,
  },
  optionDisabled: {
    opacity: 0.5,
  },
  pressed: {
    opacity: 0.85,
  },
  optionTitle: {
    ...type.emphasis,
    color: colors.text,
    marginBottom: 3,
  },
  optionCopy: {
    ...type.bodySmall,
    color: colors.textMuted,
  },
});
