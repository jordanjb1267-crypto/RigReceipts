import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, palette, radii, sizes, spacing, type } from '@/theme';

export interface ChecklistItem {
  key: string;
  label: string;
  /** Right-hand hint, e.g. a time estimate ("~1 min"). Shown as "done" when done. */
  hint: string;
  done: boolean;
  /** Tapping an incomplete row acts on it; omit for rows that complete on their own. */
  onPress?: () => void;
}

/**
 * Road-Board "finish setting up" widget (README §Road Board / §Setup checklist).
 * A progress bar over five rows; completing one fills its box Route Green, dims
 * the label, and advances the bar. Render nothing once every row is complete.
 */
export function SetupChecklist({
  items,
  onDismiss,
}: {
  items: ChecklistItem[];
  onDismiss?: () => void;
}) {
  const done = items.filter((i) => i.done).length;
  const total = items.length;
  if (total === 0 || done === total) return null;
  const pct = Math.round((done / total) * 100);

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.label}>Finish setting up</Text>
        <View style={styles.headerRight}>
          <Text style={styles.count}>
            {done}/{total}
          </Text>
          {onDismiss && (
            <Pressable accessibilityLabel="Hide setup" hitSlop={8} onPress={onDismiss}>
              <Text style={styles.dismiss}>✕</Text>
            </Pressable>
          )}
        </View>
      </View>

      <View style={styles.track}>
        <View style={[styles.fill, { width: `${pct}%` }]} />
      </View>

      <View style={styles.rows}>
        {items.map((item) => {
          const Row = item.done || !item.onPress ? View : Pressable;
          return (
            <Row
              key={item.key}
              {...(item.onPress && !item.done
                ? { accessibilityRole: 'button' as const, onPress: item.onPress }
                : {})}
              style={styles.row}
            >
              <View style={[styles.box, item.done && styles.boxDone]}>
                {item.done && <Text style={styles.check}>✓</Text>}
              </View>
              <Text style={[styles.rowLabel, item.done && styles.rowLabelDone]}>{item.label}</Text>
              <Text style={styles.hint}>{item.done ? 'done' : item.hint}</Text>
            </Row>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: radii.card,
    borderWidth: 1,
    marginTop: spacing.md,
    padding: spacing.lg,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  label: { ...type.label, color: colors.textFaint },
  headerRight: { alignItems: 'center', flexDirection: 'row', gap: spacing.md },
  count: { ...type.dataLabel, color: colors.action },
  dismiss: { color: colors.textGhost, fontSize: 13 },
  track: {
    backgroundColor: colors.border,
    borderRadius: radii.pill,
    height: sizes.progressBar,
    overflow: 'hidden',
  },
  fill: { backgroundColor: colors.action, borderRadius: radii.pill, height: sizes.progressBar },
  rows: { marginTop: spacing.md },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    paddingVertical: spacing.sm + 2,
  },
  box: {
    alignItems: 'center',
    borderColor: colors.textGhost,
    borderRadius: 7,
    borderWidth: 2,
    height: 22,
    justifyContent: 'center',
    width: 22,
  },
  boxDone: {
    backgroundColor: palette.routeGreen,
    borderColor: palette.routeGreen,
  },
  check: { color: palette.mapIvory, fontSize: 12, fontWeight: '900' },
  rowLabel: { ...type.rowTitle, color: colors.text, flex: 1 },
  rowLabelDone: { color: colors.textMuted },
  hint: { ...type.dataLabel, color: colors.textFaint },
});
