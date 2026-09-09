import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { track } from '@/analytics';
import { Button, Pill } from '@/components';
import { PAYWALL_TRIGGER_COPY, resolvePaywallTrigger, TIER_INFO, Tier } from '@/domain';
import { createPurchasesAdapter, purchasesMode } from '@/payments/purchases';
import { useSubscriptionStore } from '@/store/subscription';
import { colors, fonts, radii, spacing, type } from '@/theme';

const MODE_NOTE: Record<ReturnType<typeof purchasesMode>, string> = {
  sandbox:
    'Sandbox purchases — App Store / Google Play billing connects via RevenueCat before launch.',
  test_store: 'RevenueCat Test Store — purchases are simulated on this build, not charged.',
  live: 'Secure billing through RevenueCat, the App Store, and Google Play.',
};

/** Value hierarchy — four points, amber checks (design handoff §22). */
const VALUE_POINTS = [
  'Check whether the load clears your target.',
  'Compare recent community rates with your costs.',
  'Track actual load profitability.',
  'Organize receipts, miles, and tax records.',
];

/** Contextual paywall (Sections 45-46). Never shown before first value. */
export default function PaywallModal() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ trigger?: string }>();
  const trigger = resolvePaywallTrigger(params.trigger);
  const copy = PAYWALL_TRIGGER_COPY[trigger];

  const setTier = useSubscriptionStore((s) => s.setTier);
  const [purchasing, setPurchasing] = useState<Tier | null>(null);
  const adapter = useMemo(() => createPurchasesAdapter(setTier), [setTier]);
  const mode = useMemo(() => purchasesMode(), []);

  useEffect(() => {
    track('paywall_viewed', { trigger });
  }, [trigger]);

  const buy = async (tier: Tier) => {
    track('subscription_plan_selected', { tier, trigger });
    setPurchasing(tier);
    const result = await adapter.purchase(tier, tier === 'lifetime' ? 'lifetime' : 'monthly');
    setPurchasing(null);
    if (result.ok) {
      track('subscription_started', { tier, sandbox: result.sandbox });
      router.back();
    }
  };

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <Text style={styles.kicker}>Know what the load really pays.</Text>
        <Pressable accessibilityLabel="Close" onPress={() => router.back()} style={styles.closeBtn}>
          <Text style={styles.closeText}>✕</Text>
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + spacing.xxl }]}
      >
        <Text style={styles.title}>{copy.headline}</Text>
        <Text style={styles.copy}>{copy.body}</Text>

        <View style={styles.values}>
          {VALUE_POINTS.map((v) => (
            <View key={v} style={styles.valueRow}>
              <Text style={styles.valueCheck}>✓</Text>
              <Text style={styles.valueText}>{v}</Text>
            </View>
          ))}
        </View>

        {/* Owner-Operator — the primary plan for individual drivers (Section 42). */}
        <View style={[styles.plan, styles.planPrimary]}>
          <View style={styles.planHead}>
            <Text style={styles.planName}>{TIER_INFO.owner_operator.name}</Text>
            <Pill label="Most popular" tone="green" />
          </View>
          <Text style={styles.planPrice}>
            ${TIER_INFO.owner_operator.monthlyUsd}/mo
            <Text style={styles.planAlt}> · ${TIER_INFO.owner_operator.annualUsd}/yr</Text>
          </Text>
          <Text style={styles.planCopy}>
            Unlimited Rate Checks, full Freight Intelligence, unlimited Compare to My Costs, lane
            history and alerts.
          </Text>
          <Button
            label={purchasing === 'owner_operator' ? 'Starting…' : 'Start Owner-Operator'}
            loading={purchasing === 'owner_operator'}
            onPress={() => buy('owner_operator')}
          />
        </View>

        <View style={styles.plan}>
          <Text style={styles.planName}>{TIER_INFO.driver_pro.name}</Text>
          <Text style={styles.planPrice}>
            ${TIER_INFO.driver_pro.monthlyUsd}/mo
            <Text style={styles.planAlt}> · ${TIER_INFO.driver_pro.annualUsd}/yr</Text>
          </Text>
          <Text style={styles.planCopy}>
            Unlimited broker checks, rate-con scanning, load documents, cloud backup.
          </Text>
          <Button
            label={purchasing === 'driver_pro' ? 'Starting…' : 'Choose Driver Pro'}
            variant="secondary"
            loading={purchasing === 'driver_pro'}
            onPress={() => buy('driver_pro')}
          />
        </View>

        <Pressable onPress={() => buy('lifetime')} style={styles.lifetime}>
          <Text style={styles.lifetimeText}>
            Founder Lifetime — ${TIER_INFO.lifetime.oneTimeUsd} one-time. Core RigReceipts + Phase
            One Freight Intelligence, forever.
          </Text>
        </Pressable>

        <Button label="Maybe Later" variant="secondary" onPress={() => router.back()} />

        <Text style={styles.sandboxNote}>{MODE_NOTE[mode]}</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: colors.background, flex: 1 },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: spacing.sm,
    paddingHorizontal: spacing.xl,
  },
  kicker: { ...type.label, color: colors.textMuted, flex: 1 },
  closeBtn: {
    alignItems: 'center',
    backgroundColor: 'rgba(244, 241, 232, 0.06)',
    borderRadius: radii.sm,
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  closeText: { color: colors.text, fontSize: 15 },
  body: { paddingHorizontal: spacing.xl },
  title: { ...type.h1, color: colors.text, marginTop: spacing.sm },
  copy: { ...type.body, color: colors.textMuted, marginTop: spacing.md },
  values: { marginTop: spacing.lg },
  valueRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.md, paddingVertical: 7 },
  valueCheck: {
    color: colors.action,
    fontFamily: fonts.black,
    fontSize: 14,
    width: 16,
  },
  valueText: { ...type.body, color: colors.text, flex: 1 },
  plan: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.md + 2,
    borderWidth: 1,
    gap: spacing.sm,
    marginTop: spacing.md,
    padding: spacing.lg,
  },
  planPrimary: { borderColor: colors.action, borderWidth: 2 },
  planHead: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  planName: { ...type.h2, color: colors.text },
  planPrice: {
    color: colors.text,
    fontFamily: fonts.black,
    fontSize: 24,
    fontVariant: ['tabular-nums'],
    letterSpacing: -0.8,
  },
  planAlt: { ...type.body, color: colors.textMuted },
  planCopy: { ...type.bodySmall, color: colors.textMuted, marginBottom: spacing.sm },
  lifetime: {
    backgroundColor: 'rgba(200, 145, 45, 0.10)',
    borderColor: 'rgba(200, 145, 45, 0.25)',
    borderRadius: radii.md,
    borderWidth: 1,
    marginBottom: spacing.md,
    marginTop: spacing.md,
    padding: spacing.md,
  },
  lifetimeText: { ...type.bodySmall, color: colors.text },
  sandboxNote: {
    ...type.bodySmall,
    color: colors.textMuted,
    marginTop: spacing.lg,
    textAlign: 'center',
  },
});
