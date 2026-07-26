import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { track } from '@/analytics';
import { Button, Pill } from '@/components';
import {
  BoardTab,
  CommunityRatePost,
  EQUIPMENT_TYPES,
  EquipmentType,
  equipmentLabel,
  filterCommunityPosts,
  laneKey,
  RATE_REPORT_CATEGORIES,
} from '@/domain';
import { blockContributorByPost, reportPost } from '@/data/rateBoardApi';
import { useRateBoard } from '@/data/useRateBoard';
import { useAuthStore } from '@/store/auth';
import { useRateBoardStore } from '@/store/rateBoard';
import { colors, fonts, palette, radii, spacing, type } from '@/theme';

const TABS: { key: BoardTab; label: string }[] = [
  { key: 'for_you', label: 'For You' },
  { key: 'recent', label: 'Recent' },
  { key: 'watched', label: 'Watched Lanes' },
  { key: 'completed', label: 'Completed Loads' },
];

export default function RateBoardScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { data, isPending, isError, refetch, source } = useRateBoard();
  const [tab, setTab] = useState<BoardTab>('for_you');
  const [equipment, setEquipment] = useState<EquipmentType | undefined>();
  const [completedOnly, setCompletedOnly] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [reportFor, setReportFor] = useState<CommunityRatePost | null>(null);

  const hiddenIds = useRateBoardStore((s) => s.hiddenIds);
  const blockedContributors = useRateBoardStore((s) => s.blockedContributors);
  const watchedLanes = useRateBoardStore((s) => s.watchedLanes);

  useEffect(() => {
    track('community_board_viewed', {});
  }, []);

  const posts = useMemo(
    () =>
      data
        ? filterCommunityPosts(
            data,
            tab,
            { equipmentType: equipment, completedOnly },
            { hiddenIds, blockedContributors, watchedLanes },
          )
        : [],
    [data, tab, equipment, completedOnly, hiddenIds, blockedContributors, watchedLanes],
  );

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <View style={styles.headerRow}>
          <Text style={styles.kicker}>Community</Text>
          <Pressable
            accessibilityLabel="Close"
            onPress={() => router.back()}
            style={styles.closeBtn}
          >
            <Text style={styles.closeText}>✕</Text>
          </Pressable>
        </View>
        <View style={styles.titleRow}>
          <Text style={styles.title}>Rate Board</Text>
          {source === 'sample' && <Pill label="Sample data" tone="neutral" />}
        </View>
        <Text style={styles.subtitle}>Recent driver-shared rates by lane and equipment.</Text>
        <View style={styles.clarify}>
          <Text style={styles.clarifyText}>
            Historical rate information only. These are not available loads.
          </Text>
        </View>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.tabs}
      >
        {TABS.map((t) => (
          <Pressable
            key={t.key}
            onPress={() => setTab(t.key)}
            style={[styles.tab, tab === t.key && styles.tabActive]}
          >
            <Text style={[styles.tabText, tab === t.key && styles.tabTextActive]}>{t.label}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <View style={styles.filterBar}>
        <Pressable onPress={() => setFiltersOpen(true)} style={styles.filterBtn}>
          <Text style={styles.filterBtnText}>
            Filters{equipment || completedOnly ? ' ·' : ''}
            {equipment ? ` ${equipmentLabel(equipment)}` : ''}
            {completedOnly ? ' · Completed' : ''}
          </Text>
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + spacing.xxl }]}
      >
        {isPending ? (
          <View style={styles.state}>
            <ActivityIndicator color={palette.routeGreen} />
            <Text style={styles.stateCopy}>Loading recent rates…</Text>
          </View>
        ) : isError || !data ? (
          <View style={styles.stateCard}>
            <Text style={styles.stateTitle}>Rate Board temporarily unavailable</Text>
            <Text style={styles.stateBody}>
              Your loads, receipts, and Rate Checks are still available.
            </Text>
            <View style={{ marginTop: spacing.lg }}>
              <Button label="Try Again" onPress={() => refetch()} />
            </View>
          </View>
        ) : posts.length === 0 ? (
          <View style={styles.stateCard}>
            <Text style={styles.stateTitle}>No recent verified rates found</Text>
            <Text style={styles.stateBody}>
              Try a broader filter or save this lane to watch for new posts.
            </Text>
          </View>
        ) : (
          posts.map((p) => (
            <CommunityCard
              key={p.id}
              post={p}
              onOpen={() => {
                track('community_rate_opened', { equipment_type: p.equipmentType });
                router.push({
                  pathname: '/lane-detail',
                  params: {
                    o: `${p.originMetro},${p.originState}`,
                    d: `${p.destinationMetro},${p.destinationState}`,
                    e: p.equipmentType,
                  },
                });
              }}
              onCompare={() =>
                router.push({
                  pathname: '/compare',
                  params: {
                    rpm: String(p.allMileRpm ?? ''),
                    label: `${p.originMetro}, ${p.originState} → ${p.destinationMetro}, ${p.destinationState}`,
                  },
                })
              }
              onReport={() => setReportFor(p)}
            />
          ))
        )}
      </ScrollView>

      <FilterSheet
        open={filtersOpen}
        equipment={equipment}
        completedOnly={completedOnly}
        onEquipment={setEquipment}
        onCompletedOnly={setCompletedOnly}
        onClose={() => setFiltersOpen(false)}
      />
      <ReportSheet post={reportFor} onClose={() => setReportFor(null)} />
    </View>
  );
}

// ---------------------------------------------------------------------------

function CommunityCard({
  post,
  onOpen,
  onCompare,
  onReport,
}: {
  post: CommunityRatePost;
  onOpen: () => void;
  onCompare: () => void;
  onReport: () => void;
}) {
  const hidePost = useRateBoardStore((s) => s.hidePost);
  const blockContributor = useRateBoardStore((s) => s.blockContributor);
  const toggleWatchedLane = useRateBoardStore((s) => s.toggleWatchedLane);
  const isWatched = useRateBoardStore((s) => s.watchedLanes.includes(laneKey(post)));
  const userId = useAuthStore((s) => s.userId);

  const share = async () => {
    try {
      await Share.share({
        message: `${post.originMetro}, ${post.originState} → ${post.destinationMetro}, ${post.destinationState}\n${equipmentLabel(
          post.equipmentType,
        )} · All-Mile RPM $${post.allMileRpm?.toFixed(2)}\nHistorical rate via RigReceipts. Not an available load.`,
      });
    } catch {
      /* dismissed */
    }
  };

  const badge =
    post.verificationLevel === 'completed_load'
      ? 'Completed Load Verified'
      : post.verificationLevel === 'document_verified'
        ? 'Document Verified'
        : null;

  const metrics = [
    {
      label: 'Gross',
      value: post.grossRate !== null ? `$${post.grossRate.toLocaleString()}` : null,
    },
    {
      label: 'Loaded RPM',
      value: post.loadedRpm !== null ? `$${post.loadedRpm.toFixed(2)}` : null,
    },
    {
      label: 'All-Mile',
      value: post.allMileRpm !== null ? `$${post.allMileRpm.toFixed(2)}` : null,
    },
  ].filter((m) => m.value);

  return (
    <View style={styles.card}>
      <Pressable onPress={onOpen}>
        <Text style={styles.cardRoute}>
          {post.originMetro.toUpperCase()}, {post.originState} →{' '}
          {post.destinationMetro.toUpperCase()}, {post.destinationState}
        </Text>
        <Text style={styles.cardSub}>
          {equipmentLabel(post.equipmentType)} · {cap(post.rateStatus)} · Posted{' '}
          {post.postedDaysAgo}d ago
        </Text>
        <View style={styles.cardMetrics}>
          {metrics.map((m) => (
            <View key={m.label} style={styles.cardMetric}>
              <Text style={styles.cardMetricLabel}>{m.label}</Text>
              <Text style={styles.cardMetricValue}>{m.value}</Text>
            </View>
          ))}
        </View>
        {badge && <Text style={styles.cardBadge}>✓ {badge}</Text>}
      </Pressable>

      <View style={styles.cardActions}>
        <Pressable style={[styles.action, styles.actionPrimary]} onPress={onCompare}>
          <Text style={styles.actionPrimaryText}>Compare to My Costs</Text>
        </Pressable>
        <Pressable
          style={styles.action}
          onPress={() => {
            toggleWatchedLane(laneKey(post));
            if (!isWatched) track('lane_saved', { source: 'board' });
          }}
        >
          <Text style={styles.actionText}>{isWatched ? 'Saved ✓' : 'Save Lane'}</Text>
        </Pressable>
        <Pressable style={styles.action} onPress={share}>
          <Text style={styles.actionText}>Share</Text>
        </Pressable>
      </View>

      <View style={styles.cardModerate}>
        <Pressable onPress={onReport}>
          <Text style={styles.moderateText}>Report</Text>
        </Pressable>
        <Text style={styles.moderateDot}>·</Text>
        <Pressable onPress={() => hidePost(post.id)}>
          <Text style={styles.moderateText}>Hide</Text>
        </Pressable>
        <Text style={styles.moderateDot}>·</Text>
        <Pressable
          onPress={() => {
            // Hides immediately via the local store; the server block row makes
            // the exclusion durable (RLS filters their future posts).
            blockContributor(post.contributorId);
            if (userId) blockContributorByPost(userId, post.id).catch(() => {});
            track('contributor_blocked', {});
          }}
        >
          <Text style={styles.moderateText}>Block</Text>
        </Pressable>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------

function FilterSheet({
  open,
  equipment,
  completedOnly,
  onEquipment,
  onCompletedOnly,
  onClose,
}: {
  open: boolean;
  equipment: EquipmentType | undefined;
  completedOnly: boolean;
  onEquipment: (e: EquipmentType | undefined) => void;
  onCompletedOnly: (v: boolean) => void;
  onClose: () => void;
}) {
  return (
    <Modal visible={open} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.sheetBackdrop} onPress={onClose} />
      <View style={styles.sheet}>
        <Text style={styles.sheetTitle}>Filters</Text>
        <Text style={styles.sheetLabel}>Equipment</Text>
        <View style={styles.chipWrap}>
          {EQUIPMENT_TYPES.map((e) => (
            <Pressable
              key={e.slug}
              onPress={() => onEquipment(equipment === e.slug ? undefined : e.slug)}
              style={[styles.chip, equipment === e.slug && styles.chipActive]}
            >
              <Text style={[styles.chipText, equipment === e.slug && styles.chipTextActive]}>
                {e.label}
              </Text>
            </Pressable>
          ))}
        </View>
        <Pressable
          onPress={() => onCompletedOnly(!completedOnly)}
          style={[styles.toggleFilter, completedOnly && styles.toggleFilterActive]}
        >
          <Text style={[styles.chipText, completedOnly && styles.chipTextActive]}>
            {completedOnly ? '✓ ' : ''}Completed loads only
          </Text>
        </Pressable>
        <View style={{ marginTop: spacing.lg }}>
          <Button label="Show Rates" onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

function ReportSheet({ post, onClose }: { post: CommunityRatePost | null; onClose: () => void }) {
  const [done, setDone] = useState(false);
  const userId = useAuthStore((s) => s.userId);
  return (
    <Modal visible={post !== null} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.sheetBackdrop} onPress={onClose} />
      <View style={styles.sheet}>
        {done ? (
          <>
            <Text style={styles.sheetTitle}>Thanks. We’ll review this rate card.</Text>
            <View style={{ marginTop: spacing.lg }}>
              <Button
                label="Done"
                onPress={() => {
                  setDone(false);
                  onClose();
                }}
              />
            </View>
          </>
        ) : (
          <>
            <Text style={styles.sheetTitle}>Report this rate card</Text>
            {RATE_REPORT_CATEGORIES.map((c) => (
              <Pressable
                key={c.slug}
                style={styles.reportRow}
                onPress={() => {
                  track('rate_board_post_reported', { category: c.slug });
                  // Best-effort server report; the thank-you is shown either way
                  // and the moderation queue picks it up when it lands.
                  if (userId && post) reportPost(userId, post.id, c.slug).catch(() => {});
                  setDone(true);
                }}
              >
                <Text style={styles.reportText}>{c.label}</Text>
                <Text style={styles.reportChevron}>›</Text>
              </Pressable>
            ))}
          </>
        )}
      </View>
    </Modal>
  );
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const styles = StyleSheet.create({
  root: { backgroundColor: colors.background, flex: 1 },
  header: { paddingHorizontal: spacing.xl },
  headerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  kicker: { ...type.label, color: colors.textMuted },
  titleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  closeBtn: {
    alignItems: 'center',
    backgroundColor: 'rgba(244, 241, 232, 0.06)',
    borderRadius: radii.sm,
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  closeText: { color: colors.text, fontSize: 15 },
  title: { ...type.h1, color: colors.text },
  subtitle: { ...type.body, color: colors.textMuted, marginTop: spacing.xs },
  clarify: {
    backgroundColor: 'rgba(61, 100, 128, 0.10)',
    borderRadius: radii.sm,
    marginTop: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  clarifyText: { ...type.labelTiny, color: palette.highwayBlue, letterSpacing: 0.4 },
  tabs: { gap: spacing.sm, paddingHorizontal: spacing.xl, paddingVertical: spacing.md },
  tab: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.pill,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  tabActive: { backgroundColor: colors.surfaceDark, borderColor: colors.surfaceDark },
  tabText: { ...type.emphasis, color: colors.textMuted, fontSize: 12 },
  tabTextActive: { color: colors.textOnDark },
  filterBar: { paddingBottom: spacing.sm, paddingHorizontal: spacing.xl },
  filterBtn: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(244, 241, 232, 0.06)',
    borderRadius: radii.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  filterBtnText: { ...type.labelTiny, color: colors.text },
  body: { paddingHorizontal: spacing.xl },
  // states
  state: { alignItems: 'center', gap: spacing.md, paddingVertical: spacing.xxl },
  stateCopy: { ...type.body, color: colors.textMuted },
  stateCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    marginTop: spacing.md,
    padding: spacing.xl,
  },
  stateTitle: { ...type.h2, color: colors.text },
  stateBody: { ...type.body, color: colors.textMuted, marginTop: spacing.sm },
  // card
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.md + 2,
    borderWidth: 1,
    marginBottom: spacing.md,
    padding: spacing.lg,
  },
  cardRoute: { color: colors.text, fontFamily: fonts.black, fontSize: 16, letterSpacing: -0.4 },
  cardSub: { ...type.labelTiny, color: colors.textMuted, marginTop: 5 },
  cardMetrics: { flexDirection: 'row', marginTop: spacing.md },
  cardMetric: { flex: 1 },
  cardMetricLabel: { ...type.labelTiny, color: colors.textMuted, marginBottom: 3 },
  cardMetricValue: {
    color: colors.text,
    fontFamily: fonts.black,
    fontSize: 18,
    fontVariant: ['tabular-nums'],
    letterSpacing: -0.5,
  },
  cardBadge: { ...type.labelTiny, color: colors.good, marginTop: spacing.md },
  cardActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },
  action: {
    alignItems: 'center',
    backgroundColor: 'rgba(244, 241, 232, 0.06)',
    borderRadius: radii.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
  actionPrimary: { backgroundColor: palette.routeGreen, flex: 1 },
  actionPrimaryText: { color: palette.mapIvory, fontFamily: fonts.bold, fontSize: 12 },
  actionText: { color: colors.text, fontFamily: fonts.bold, fontSize: 12 },
  cardModerate: {
    alignItems: 'center',
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
    paddingTop: spacing.md,
  },
  moderateText: { ...type.labelTiny, color: colors.textMuted },
  moderateDot: { color: colors.textMuted },
  // sheet
  sheetBackdrop: { backgroundColor: 'rgba(9,12,14,0.72)', flex: 1 },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    padding: spacing.xl,
    paddingBottom: spacing.xxl,
  },
  sheetTitle: { ...type.h2, color: colors.text, marginBottom: spacing.md },
  sheetLabel: { ...type.label, color: colors.textMuted, marginBottom: spacing.sm },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.pill,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  chipActive: { backgroundColor: palette.routeGreen, borderColor: palette.routeGreen },
  chipText: { ...type.emphasis, color: colors.text, fontSize: 12 },
  chipTextActive: { color: palette.mapIvory },
  toggleFilter: {
    alignSelf: 'flex-start',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.pill,
    borderWidth: 1,
    marginTop: spacing.lg,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  toggleFilterActive: { backgroundColor: palette.routeGreen, borderColor: palette.routeGreen },
  reportRow: {
    alignItems: 'center',
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
  },
  reportText: { ...type.body, color: colors.text },
  reportChevron: { color: colors.textMuted, fontSize: 18 },
});
