import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ActionItem, ActionUrgency } from '@/domain';
import { colors, palette, radii, spacing, type } from '@/theme';

import { Pill } from './Pill';

const URGENCY_TONE: Record<ActionUrgency, 'rust' | 'amber' | 'neutral'> = {
  now: 'rust',
  soon: 'amber',
  later: 'neutral',
};

const URGENCY_LABEL: Record<ActionUrgency, string> = {
  now: 'Now',
  soon: 'Soon',
  later: 'Later',
};

interface NextActionCardProps {
  item: ActionItem;
  onPress: () => void;
  ctaLabel?: string;
}

/** One obvious next action — title, deterministic reason, explicit CTA. */
export function NextActionCard({ item, onPress, ctaLabel = 'Continue' }: NextActionCardProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${item.title}. ${item.context}`}
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <View style={styles.head}>
        <Text style={styles.kicker}>Next action</Text>
        <Pill label={URGENCY_LABEL[item.urgency]} tone={URGENCY_TONE[item.urgency]} />
      </View>
      <Text style={styles.title}>{item.title}</Text>
      <Text style={styles.context}>{item.context}</Text>
      <Text style={styles.reason}>{item.reason}</Text>
      <Text style={styles.cta}>{ctaLabel} →</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.card,
    borderWidth: 1,
    marginTop: spacing.md,
    padding: spacing.lg,
  },
  pressed: { opacity: 0.85 },
  head: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  kicker: { ...type.label, color: colors.textFaint },
  title: { ...type.h2, color: colors.text },
  context: { ...type.body, color: colors.textMuted, marginTop: spacing.xs },
  reason: { ...type.bodySmall, color: colors.textMuted, marginTop: spacing.sm },
  cta: { ...type.emphasis, color: palette.highwayBlue, marginTop: spacing.md },
});
