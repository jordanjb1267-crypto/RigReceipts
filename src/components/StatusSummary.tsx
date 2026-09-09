import { StyleSheet, View } from 'react-native';

import { spacing, Tone } from '@/theme';

import { Pill } from './Pill';

export interface StatusSummaryItem {
  key: string;
  label: string;
  tone?: Tone;
}

interface StatusSummaryProps {
  items: readonly StatusSummaryItem[];
}

/** Compact status chips for the current object state. */
export function StatusSummary({ items }: StatusSummaryProps) {
  if (items.length === 0) return null;
  return (
    <View style={styles.row}>
      {items.map((item) => (
        <Pill key={item.key} label={item.label} tone={item.tone ?? 'neutral'} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
});
