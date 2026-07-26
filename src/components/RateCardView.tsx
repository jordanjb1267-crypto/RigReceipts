import { StyleSheet, Text, View } from 'react-native';

import { equipmentLabel, SafeRateCard, VerificationLevel } from '@/domain';
import { colors, fonts, radii, spacing, type } from '@/theme';

const VERIFICATION_BADGE: Record<VerificationLevel, string | null> = {
  self_entered: null,
  document_verified: 'Document Verified',
  completed_load: 'Completed Load Verified',
  settlement_verified: 'Settlement Verified',
};

const RATE_STATUS_LABEL: Record<SafeRateCard['rateStatus'], string> = {
  offered: 'Offered',
  accepted: 'Accepted',
  completed: 'Completed',
};

const rpm = (n: number | null) => (n === null ? null : `$${n.toFixed(2)}`);
const usd = (n: number | null) => (n === null ? null : `$${Math.round(n).toLocaleString()}`);

/**
 * Renders a privacy-safe rate card (Section 5). Only ever shows the allow-listed
 * fields on a SafeRateCard — there is no path to private data here. The footer
 * clarifies it is historical, not an available load.
 */
export function RateCardView({ card }: { card: SafeRateCard }) {
  const badge = VERIFICATION_BADGE[card.verificationLevel];
  const metrics: { label: string; value: string | null }[] = [
    { label: 'Gross Rate', value: usd(card.grossRate) },
    { label: 'Loaded RPM', value: rpm(card.loadedRpm) },
    { label: 'All-Mile RPM', value: rpm(card.allMileRpm) },
    { label: 'Loaded', value: card.loadedMiles !== null ? `${card.loadedMiles} mi` : null },
    { label: 'Deadhead', value: card.deadheadMiles !== null ? `${card.deadheadMiles} mi` : null },
  ].filter((m) => m.value !== null);

  return (
    <View style={styles.card}>
      <Text style={styles.route}>
        {card.originMetro.toUpperCase()}, {card.originState} → {card.destinationMetro.toUpperCase()}
        , {card.destinationState}
      </Text>
      <Text style={styles.sub}>
        {equipmentLabel(card.equipmentType)} · {RATE_STATUS_LABEL[card.rateStatus]}
        {card.loadDateBucket ? ` · ${card.loadDateBucket}` : ''}
      </Text>

      <View style={styles.metrics}>
        {metrics.map((m) => (
          <View key={m.label} style={styles.metric}>
            <Text style={styles.metricLabel}>{m.label}</Text>
            <Text style={styles.metricValue}>{m.value}</Text>
          </View>
        ))}
      </View>

      {badge && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>✓ {badge}</Text>
        </View>
      )}

      <View style={styles.footer}>
        <Text style={styles.shared}>Shared through RigReceipts</Text>
        <Text style={styles.disclaimer}>Historical rate information. Not an available load.</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surfaceDark,
    borderColor: colors.borderOnDark,
    borderRadius: radii.md + 2,
    borderWidth: 1,
    padding: spacing.xl,
  },
  route: {
    color: colors.textOnDark,
    fontFamily: fonts.black,
    fontSize: 20,
    letterSpacing: -0.6,
  },
  sub: {
    ...type.label,
    color: 'rgba(244, 241, 232, 0.6)',
    marginTop: spacing.sm,
  },
  metrics: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: spacing.lg,
  },
  metric: {
    paddingVertical: spacing.sm,
    width: '50%',
  },
  metricLabel: {
    ...type.labelTiny,
    color: 'rgba(244, 241, 232, 0.55)',
    marginBottom: 4,
  },
  metricValue: {
    color: colors.textOnDark,
    fontFamily: fonts.black,
    fontSize: 22,
    fontVariant: ['tabular-nums'],
    letterSpacing: -0.8,
  },
  badge: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(46, 107, 87, 0.26)',
    borderColor: 'rgba(159, 214, 191, 0.25)',
    borderRadius: radii.pill,
    borderWidth: 1,
    marginTop: spacing.md,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  badgeText: {
    color: '#9fd6bf',
    fontFamily: fonts.extrabold,
    fontSize: 11,
  },
  footer: {
    borderTopColor: 'rgba(244, 241, 232, 0.12)',
    borderTopWidth: 1,
    marginTop: spacing.lg,
    paddingTop: spacing.md,
  },
  shared: {
    ...type.labelTiny,
    color: 'rgba(244, 241, 232, 0.7)',
  },
  disclaimer: {
    ...type.bodySmall,
    color: 'rgba(244, 241, 232, 0.5)',
    marginTop: 4,
  },
});
