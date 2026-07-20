import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Pill } from '@/components';
import {
  ACCOUNTING_CATEGORIES,
  ACCOUNTING_LABELS,
  AccountingCategory,
  effectiveMiles,
  MileageSegment,
  summarizeSegments,
  unclassifiedMiles,
} from '@/domain';
import { useLoadsStore } from '@/store/loads';
import { useMileageStore } from '@/store/mileage';
import { colors, palette, radii, spacing, type } from '@/theme';

const mi = (n: number) => `${n.toLocaleString(undefined, { maximumFractionDigits: 1 })} mi`;
const clock = (ms: number | null) =>
  ms === null
    ? 'now'
    : new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

function toneFor(category: AccountingCategory) {
  switch (category) {
    case 'loaded':
      return 'green' as const;
    case 'deadhead':
      return 'amber' as const;
    case 'business_empty':
      return 'blue' as const;
    case 'personal':
      return 'neutral' as const;
    default:
      return 'rust' as const;
  }
}

/** Daily mileage timeline + unclassified review + segment corrections (§H, §I). */
export default function MileageReviewScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const segments = useMileageStore((s) => s.segments);
  const editSegment = useMileageStore((s) => s.editSegment);
  const removeSegment = useMileageStore((s) => s.removeSegment);
  const loads = useLoadsStore((s) => s.loads);

  const [editing, setEditing] = useState<string | null>(null);

  const start = useMemo(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  }, []);
  const today = useMemo(
    () => segments.filter((s) => s.startedAt >= start).sort((a, b) => a.startedAt - b.startedAt),
    [segments, start],
  );
  const breakdown = useMemo(() => summarizeSegments(today), [today]);
  const needsReview = unclassifiedMiles(today);
  const loadNumber = (id: string | null) => loads.find((l) => l.id === id)?.loadNumber ?? null;

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <View style={styles.headerRow}>
          <Text style={styles.kicker}>Mileage Ledger</Text>
          <Pressable
            accessibilityLabel="Close"
            onPress={() => router.back()}
            style={styles.closeBtn}
          >
            <Text style={styles.closeText}>✕</Text>
          </Pressable>
        </View>
        <Text style={styles.title}>Today · {mi(breakdown.total)}</Text>
      </View>

      <ScrollView
        contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + spacing.xxl }]}
        keyboardShouldPersistTaps="handled"
      >
        {needsReview > 0 && (
          <View style={styles.reviewBanner}>
            <Text style={styles.reviewTitle}>{mi(needsReview)} need review</Text>
            <Text style={styles.reviewCopy}>
              Classify these miles to keep your deadhead and all-mile RPM accurate.
            </Text>
          </View>
        )}

        {today.length === 0 ? (
          <View style={styles.card}>
            <Text style={styles.empty}>No miles tracked today yet.</Text>
          </View>
        ) : (
          today.map((seg) => (
            <SegmentRow
              key={seg.id}
              seg={seg}
              loadNumber={loadNumber(seg.loadId)}
              loads={loads}
              editing={editing === seg.id}
              onToggle={() => setEditing(editing === seg.id ? null : seg.id)}
              onSave={(patch) => {
                editSegment(seg.id, patch);
                setEditing(null);
              }}
              onRemove={() => {
                removeSegment(seg.id);
                setEditing(null);
              }}
            />
          ))
        )}
      </ScrollView>
    </View>
  );
}

function SegmentRow({
  seg,
  loadNumber,
  loads,
  editing,
  onToggle,
  onSave,
  onRemove,
}: {
  seg: MileageSegment;
  loadNumber: string | null;
  loads: { id: string; loadNumber: string }[];
  editing: boolean;
  onToggle: () => void;
  onSave: (patch: {
    accountingCategory: AccountingCategory;
    adjustedMiles: number | null;
    loadId: string | null;
  }) => void;
  onRemove: () => void;
}) {
  const [category, setCategory] = useState<AccountingCategory>(seg.accountingCategory);
  const [milesText, setMilesText] = useState(String(effectiveMiles(seg)));
  const [loadId, setLoadId] = useState<string | null>(seg.loadId);

  const save = () => {
    const n = Number(milesText.replace(/[^0-9.]/g, ''));
    onSave({
      accountingCategory: category,
      adjustedMiles: n > 0 ? n : null,
      loadId: category === 'loaded' || category === 'deadhead' ? loadId : null,
    });
  };

  return (
    <View style={[styles.card, seg.accountingCategory === 'unclassified' && styles.cardFlag]}>
      <Pressable onPress={onToggle} style={styles.segHead}>
        <View style={{ flex: 1 }}>
          <Text style={styles.segTime}>
            {clock(seg.startedAt)} – {clock(seg.endedAt)}
          </Text>
          <Text style={styles.segMiles}>{mi(effectiveMiles(seg))}</Text>
          {loadNumber && <Text style={styles.segLoad}>Load {loadNumber}</Text>}
        </View>
        <Pill
          label={ACCOUNTING_LABELS[seg.accountingCategory]}
          tone={toneFor(seg.accountingCategory)}
        />
      </Pressable>

      {editing && (
        <View style={styles.editor}>
          <Text style={styles.editLabel}>Category</Text>
          <View style={styles.chips}>
            {ACCOUNTING_CATEGORIES.map((c) => (
              <Pressable
                key={c}
                onPress={() => setCategory(c)}
                style={[styles.chip, category === c && styles.chipActive]}
              >
                <Text style={[styles.chipText, category === c && styles.chipTextActive]}>
                  {ACCOUNTING_LABELS[c]}
                </Text>
              </Pressable>
            ))}
          </View>

          <Text style={styles.editLabel}>Miles</Text>
          <TextInput
            value={milesText}
            onChangeText={(v) => setMilesText(v.replace(/[^0-9.]/g, ''))}
            keyboardType="decimal-pad"
            style={styles.input}
            accessibilityLabel="Segment miles"
          />

          {(category === 'loaded' || category === 'deadhead') && loads.length > 0 && (
            <>
              <Text style={styles.editLabel}>Load</Text>
              <View style={styles.chips}>
                <Pressable
                  onPress={() => setLoadId(null)}
                  style={[styles.chip, loadId === null && styles.chipActive]}
                >
                  <Text style={[styles.chipText, loadId === null && styles.chipTextActive]}>
                    None
                  </Text>
                </Pressable>
                {loads.map((l) => (
                  <Pressable
                    key={l.id}
                    onPress={() => setLoadId(l.id)}
                    style={[styles.chip, loadId === l.id && styles.chipActive]}
                  >
                    <Text style={[styles.chipText, loadId === l.id && styles.chipTextActive]}>
                      {l.loadNumber}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </>
          )}

          <View style={styles.editActions}>
            <Button label="Save" onPress={save} />
            <Button label="Remove" variant="danger" onPress={onRemove} />
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: colors.background, flex: 1 },
  header: { paddingHorizontal: spacing.xl },
  headerRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  kicker: { ...type.label, color: colors.textMuted },
  closeBtn: {
    alignItems: 'center',
    backgroundColor: 'rgba(30, 35, 39, 0.06)',
    borderRadius: radii.sm,
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  closeText: { color: colors.text, fontSize: 15 },
  title: { ...type.h1, color: colors.text, marginTop: spacing.sm },
  body: { paddingHorizontal: spacing.xl, paddingTop: spacing.lg },
  reviewBanner: {
    backgroundColor: 'rgba(154, 92, 58, 0.10)',
    borderRadius: radii.md,
    marginBottom: spacing.md,
    padding: spacing.lg,
  },
  reviewTitle: { ...type.h2, color: palette.clayRust },
  reviewCopy: { ...type.bodySmall, color: colors.textMuted, marginTop: spacing.xs },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    marginBottom: spacing.md,
    padding: spacing.lg,
  },
  cardFlag: { borderColor: 'rgba(154, 92, 58, 0.35)' },
  empty: { ...type.body, color: colors.textMuted, textAlign: 'center' },
  segHead: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  segTime: { ...type.labelTiny, color: colors.textMuted },
  segMiles: {
    color: colors.text,
    fontFamily: type.metricSm.fontFamily,
    fontSize: 20,
    fontVariant: ['tabular-nums'],
    marginTop: 2,
  },
  segLoad: { ...type.bodySmall, color: colors.textMuted, marginTop: 2 },
  editor: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    marginTop: spacing.md,
    paddingTop: spacing.md,
  },
  editLabel: {
    ...type.labelTiny,
    color: colors.textMuted,
    marginBottom: spacing.sm,
    marginTop: spacing.sm,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    backgroundColor: 'rgba(30, 35, 39, 0.06)',
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
  },
  chipActive: { backgroundColor: palette.routeGreen },
  chipText: { ...type.labelTiny, color: colors.text },
  chipTextActive: { color: palette.mapIvory },
  input: {
    ...type.body,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    color: colors.text,
    paddingVertical: spacing.sm,
  },
  editActions: { gap: spacing.sm, marginTop: spacing.lg },
});
