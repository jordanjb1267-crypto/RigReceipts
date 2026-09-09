import { StyleSheet, Text, View } from 'react-native';

import { colors, palette, radii, spacing, type } from '@/theme';

export interface PacketProgressStep {
  key: string;
  label: string;
  done: boolean;
  required?: boolean;
}

interface PacketProgressProps {
  label?: string;
  steps: readonly PacketProgressStep[];
}

/** Operational progress for a load packet — local paperwork only. */
export function PacketProgress({ label = 'Packet progress', steps }: PacketProgressProps) {
  const done = steps.filter((s) => s.done).length;
  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <Text style={styles.label}>{label}</Text>
        <Text style={styles.count}>
          {done}/{steps.length}
        </Text>
      </View>
      {steps.map((step) => (
        <View key={step.key} style={styles.row}>
          <View style={[styles.dot, step.done && styles.dotDone]} />
          <Text style={[styles.step, step.done && styles.stepDone]}>{step.label}</Text>
          {step.required && !step.done ? <Text style={styles.req}>Required</Text> : null}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: spacing.sm },
  head: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  label: { ...type.label, color: colors.textFaint },
  count: { ...type.labelTiny, color: colors.textMuted },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    paddingVertical: 4,
  },
  dot: {
    backgroundColor: colors.border,
    borderRadius: radii.pill,
    height: 8,
    width: 8,
  },
  dotDone: { backgroundColor: palette.routeGreen },
  step: { ...type.bodySmall, color: colors.text, flex: 1 },
  stepDone: { color: colors.textMuted },
  req: { ...type.labelTiny, color: palette.clayRust },
});
