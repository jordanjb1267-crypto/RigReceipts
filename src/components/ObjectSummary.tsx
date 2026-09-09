import { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors, radii, spacing, Tone, type } from '@/theme';

import { Pill } from './Pill';

export interface ObjectSummaryMetric {
  label: string;
  value: string;
}

interface ObjectSummaryProps {
  kicker?: string;
  title: string;
  subtitle?: string | null;
  statusLabel?: string;
  statusTone?: Tone;
  metrics?: readonly ObjectSummaryMetric[];
  children?: ReactNode;
}

/** Primary real-world object header — one object, current state, key facts. */
export function ObjectSummary({
  kicker,
  title,
  subtitle,
  statusLabel,
  statusTone = 'neutral',
  metrics,
  children,
}: ObjectSummaryProps) {
  return (
    <View style={styles.card}>
      <View style={styles.head}>
        {kicker ? <Text style={styles.kicker}>{kicker}</Text> : null}
        {statusLabel ? <Pill label={statusLabel} tone={statusTone} /> : null}
      </View>
      <Text style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      {metrics && metrics.length > 0 ? (
        <View style={styles.metrics}>
          {metrics.map((m) => (
            <View key={m.label} style={styles.metric}>
              <Text style={styles.metricLabel}>{m.label}</Text>
              <Text style={styles.metricValue}>{m.value}</Text>
            </View>
          ))}
        </View>
      ) : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: radii.card,
    borderWidth: 1,
    marginBottom: spacing.md,
    padding: spacing.lg,
  },
  head: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  kicker: { ...type.label, color: colors.textFaint },
  title: { ...type.h1, color: colors.text, marginTop: spacing.xs },
  subtitle: { ...type.body, color: colors.textMuted, marginTop: spacing.xs },
  metrics: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    marginTop: spacing.md,
  },
  metric: { minWidth: '28%' },
  metricLabel: { ...type.labelTiny, color: colors.textMuted },
  metricValue: { ...type.emphasis, color: colors.text, marginTop: 2 },
});
