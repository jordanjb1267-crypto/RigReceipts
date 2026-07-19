import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  Button,
  Card,
  GradeBadge,
  MetricTile,
  Pill,
  RouteBand,
  TopoBackground,
  WidgetCard,
} from '@/components';
import { isFeatureEnabled } from '@/config/flags';
import { last7dRange, monthRange, summarizeRange } from '@/domain';
import { useBoard } from '@/data/useBoard';
import type { BoardData } from '@/mock/board';
import { useCapturesStore } from '@/store/captures';
import { Role, useOnboardingStore } from '@/store/onboarding';
import { colors, fonts, palette, radii, spacing, toneColors, Tone, type } from '@/theme';

/** Real captured-spend summary, derived from the local capture queue. */
interface ReceiptsSummary {
  hasRecords: boolean;
  monthLabel: string;
  monthTotalUsd: number;
  weekTotalUsd: number;
  records: number;
  topLabel: string;
  topAmountUsd: number;
}

const usd = (n: number) => `$${Math.round(n).toLocaleString()}`;
const rpm = (n: number) => `$${n.toFixed(2)}`;

const ROLE_LABEL: Record<Role, string> = {
  owner_operator: 'Owner-Operator',
  leased_owner_operator: 'Leased-On O/O',
  company_driver: 'Company Driver',
  small_fleet: 'Small Fleet',
  dispatcher_ops: 'Dispatcher / Ops',
  just_starting: 'Getting Started',
};

export default function DashboardScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const role = useOnboardingStore((s) => s.role);
  const { data, isPending, isError, refetch } = useBoard();
  const captures = useCapturesStore((s) => s.captures);

  const receipts = useMemo<ReceiptsSummary>(() => {
    const now = new Date();
    const month = monthRange(now);
    const m = summarizeRange(captures, month);
    const w = summarizeRange(captures, last7dRange(now));
    const records = m.expenseCount + m.documentCount;
    return {
      hasRecords: records > 0,
      monthLabel: month.label ?? 'This month',
      monthTotalUsd: m.totalUsd,
      weekTotalUsd: w.totalUsd,
      records,
      topLabel: m.topCategory?.label ?? '—',
      topAmountUsd: m.topCategory?.totalUsd ?? 0,
    };
  }, [captures]);

  return (
    <View style={styles.root}>
      <TopoBackground opacity={0.1} />
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + spacing.md, paddingBottom: spacing.xxl * 3 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <Header role={role} onProfile={() => router.push('/reports')} />

        {isPending ? (
          <LoadingState />
        ) : isError || !data ? (
          <ErrorState onRetry={() => refetch()} />
        ) : (
          <Board
            data={data}
            receipts={receipts}
            onNavigate={(path) => router.push(path)}
            onOpenCloseout={() => router.push('/monthly-closeout')}
          />
        )}
      </ScrollView>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Header (logo, week, profile selector, notifications)
// ---------------------------------------------------------------------------

function Header({ role, onProfile }: { role: Role | null; onProfile: () => void }) {
  const initials = role ? ROLE_LABEL[role].slice(0, 2).toUpperCase() : 'RR';
  return (
    <View style={styles.header}>
      <View style={styles.logoRow}>
        <View style={styles.logoMark}>
          <Text style={styles.logoLetter}>R</Text>
        </View>
        <Text style={styles.brand}>RigReceipts</Text>
      </View>
      <View style={styles.headerActions}>
        <Pressable accessibilityLabel="Search" style={styles.iconBtn}>
          <Text style={styles.iconGlyph}>⌕</Text>
        </Pressable>
        <Pressable accessibilityLabel="Notifications" style={styles.iconBtn}>
          <Text style={styles.iconGlyph}>◔</Text>
        </Pressable>
        <Pressable accessibilityLabel="Profile" onPress={onProfile} style={styles.avatar}>
          <Text style={styles.avatarText}>{initials}</Text>
        </Pressable>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------

function LoadingState() {
  return (
    <View style={styles.centerState}>
      <ActivityIndicator color={palette.routeGreen} />
      <Text style={styles.stateCopy}>Loading your road board…</Text>
      <View style={styles.skeletonHero} />
      <View style={styles.skeletonRow}>
        <View style={styles.skeletonTile} />
        <View style={styles.skeletonTile} />
      </View>
    </View>
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <Card style={styles.errorCard}>
      <Text style={styles.errorTitle}>Could not load your board.</Text>
      <Text style={styles.errorCopy}>Check your connection and try again.</Text>
      <View style={{ marginTop: spacing.lg }}>
        <Button label="Retry" onPress={onRetry} />
      </View>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Board
// ---------------------------------------------------------------------------

type TabPath = '/scan' | '/loads' | '/miles' | '/reports' | '/rate-board';

function Board({
  data,
  receipts,
  onNavigate,
  onOpenCloseout,
}: {
  data: BoardData;
  receipts: ReceiptsSummary;
  onNavigate: (p: TabPath) => void;
  onOpenCloseout: () => void;
}) {
  const isEmpty =
    data.spend.total7dUsd === 0 && data.moneyOwed.totalUsd === 0 && data.loads.activeCount === 0;

  return (
    <>
      <View style={styles.titleBlock}>
        <Text style={styles.kicker}>{data.weekOf}</Text>
        <Text style={styles.headline}>{data.headline}</Text>
      </View>

      {receipts.hasRecords && (
        <ReceiptsWidget receipts={receipts} onOpenCloseout={onOpenCloseout} />
      )}

      {isEmpty ? (
        <EmptyBoard onNavigate={onNavigate} />
      ) : (
        <PopulatedBoard data={data} onNavigate={onNavigate} />
      )}
    </>
  );
}

/**
 * Real captured-spend widget — the driver's own receipts, not sample data.
 * Appears whenever the capture queue has anything this month, in both the
 * empty and populated board states.
 */
function ReceiptsWidget({
  receipts,
  onOpenCloseout,
}: {
  receipts: ReceiptsSummary;
  onOpenCloseout: () => void;
}) {
  return (
    <WidgetCard
      label="Your Receipts"
      headerRight={<Pill label="From your scans" tone="green" />}
      onPress={onOpenCloseout}
    >
      <Text style={styles.bigNum}>{usd(receipts.monthTotalUsd)}</Text>
      <Text style={styles.widgetNote}>
        {receipts.monthLabel} · {receipts.records} {receipts.records === 1 ? 'record' : 'records'}{' '}
        captured
      </Text>
      <View style={styles.metricRow}>
        <MetricTile label="Last 7 days" value={usd(receipts.weekTotalUsd)} />
        <MetricTile
          label="Top category"
          value={receipts.topLabel}
          caption={receipts.topAmountUsd > 0 ? usd(receipts.topAmountUsd) : undefined}
        />
      </View>
    </WidgetCard>
  );
}

function EmptyBoard({ onNavigate }: { onNavigate: (p: TabPath) => void }) {
  return (
    <>
      <Card dark label="This Week" labelRight="No records yet">
        <Text style={styles.heroMetric}>$—/mi</Text>
        <Text style={styles.heroNote}>
          Capture a receipt, load, or trip and your rate per mile, spend, and money owed appear
          here.
        </Text>
      </Card>
      <QuickActions onNavigate={onNavigate} />
      <RouteBand
        marker="1"
        markerTone="green"
        title="Scan a receipt"
        subtitle="Fuel, lumper, repairs, meals."
        value="Go"
        onPress={() => onNavigate('/scan')}
      />
      <RouteBand
        marker="2"
        markerTone="blue"
        title="Create a load"
        subtitle="BOL, POD, detention, lumper."
        value="Go"
        onPress={() => onNavigate('/loads')}
      />
      <RouteBand
        marker="3"
        markerTone="amber"
        title="Track miles"
        subtitle="Loaded and deadhead."
        value="Go"
        onPress={() => onNavigate('/miles')}
      />
    </>
  );
}

function PopulatedBoard({
  data,
  onNavigate,
}: {
  data: BoardData;
  onNavigate: (p: TabPath) => void;
}) {
  return (
    <>
      {/* Status strip */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.statusStrip}
      >
        <StatusChip label="RPM" value={data.rpm.grade} tone="green" />
        <StatusChip label="Owed" value={usd(data.moneyOwed.totalUsd)} tone="amber" />
        <StatusChip label="Records" value={`${data.records.pct}%`} tone="blue" />
        <StatusChip label="Loads" value={`${data.loads.activeCount} active`} tone="neutral" />
      </ScrollView>

      {/* This Week hero */}
      <Card dark label="This Week's RPM Score" labelRight={data.rpm.grade}>
        <Text style={styles.heroMetric}>{rpm(data.rpm.actualRpm)}/mi</Text>
        <Text style={styles.heroNote}>{data.rpm.note}</Text>
        <View style={styles.metricRow}>
          <MetricTile dark label="Target" value={rpm(data.rpm.targetRpm)} />
          <MetricTile dark label="CPM" value={rpm(data.rpm.cpm)} />
          <MetricTile dark label="Owed" value={usd(data.rpm.owedUsd)} />
        </View>
        <View style={styles.sampleTag}>
          <Pill label="Sample data" tone="neutral" />
        </View>
      </Card>

      <QuickActions onNavigate={onNavigate} />

      {/* Freight Intelligence (Section 36) — entry point, flag-gated. */}
      {isFeatureEnabled('freight_intelligence_enabled') && (
        <WidgetCard
          label="Freight Intelligence"
          headerRight={<Pill label="Rates" tone="green" />}
          onPress={() =>
            isFeatureEnabled('community_rate_board_enabled')
              ? onNavigate('/rate-board')
              : onNavigate('/reports')
          }
        >
          <Text style={styles.widgetNote}>
            Check rates, brokers, and recent community lane activity.
          </Text>
          <View style={styles.fiRow}>
            {['Check Rate', 'Rate Board', 'Broker', 'Pulse'].map((entry) => (
              <View key={entry} style={styles.fiChip}>
                <Text style={styles.fiChipText}>{entry}</Text>
              </View>
            ))}
          </View>
        </WidgetCard>
      )}

      {/* Loads in Motion */}
      <WidgetCard
        label="Loads in Motion"
        headerRight={<Pill label={`${data.loads.activeCount} active`} tone="blue" />}
        onPress={() => onNavigate('/loads')}
      >
        {data.loads.items.map((load) => (
          <View key={load.loadNumber} style={styles.loadRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.loadNumber}>Load {load.loadNumber}</Text>
              <Text style={styles.loadRoute}>{load.route}</Text>
            </View>
            <Pill label={load.statusLabel} tone={load.statusTone} />
          </View>
        ))}
      </WidgetCard>

      {/* Road Spend */}
      <WidgetCard
        label="Road Spend"
        headerRight={<Text style={styles.widgetValue}>7 days</Text>}
        onPress={() => onNavigate('/reports')}
      >
        <Text style={styles.bigNum}>{usd(data.spend.total7dUsd)}</Text>
        <Text style={styles.widgetNote}>{data.spend.note}</Text>
      </WidgetCard>

      {/* Money Owed */}
      <WidgetCard
        label="Money Owed"
        headerRight={<Text style={styles.widgetValue}>{usd(data.moneyOwed.totalUsd)}</Text>}
        onPress={() => onNavigate('/loads')}
      >
        {data.moneyOwed.items.map((item) => (
          <View key={item.label} style={styles.owedRow}>
            <Text style={styles.owedLabel}>{item.label}</Text>
            <Text style={[styles.owedAmount, { color: colors.text }]}>{usd(item.amountUsd)}</Text>
          </View>
        ))}
      </WidgetCard>

      {/* RPM Coach */}
      <WidgetCard
        label="RPM Coach"
        headerRight={<Text style={styles.widgetValue}>Target {rpm(data.rpmCoach.targetRpm)}</Text>}
        onPress={() => onNavigate('/reports')}
      >
        <View style={styles.metricRow}>
          <MetricTile
            label="Break-even"
            value={rpm(data.rpmCoach.breakEvenRpm)}
            caption="All miles"
          />
          <MetricTile
            label="Deadhead"
            value={`-${data.rpmCoach.deadheadImpactCents}¢`}
            caption="Margin hit"
          />
        </View>
      </WidgetCard>

      {/* Calendar Snapshot */}
      <WidgetCard
        label="Calendar Snapshot"
        headerRight={<Text style={styles.widgetValue}>{usd(data.calendar.monthTotalUsd)}</Text>}
        onPress={() => onNavigate('/reports')}
      >
        <Text style={styles.widgetNote}>{data.calendar.monthLabel}</Text>
        <View style={styles.calRow}>
          {data.calendar.recentDays.map((d) => (
            <View key={d.day} style={[styles.calCell, calTone(d.tone)]}>
              <Text style={styles.calDay}>{d.day}</Text>
              <Text style={styles.calSpend}>{d.spendUsd > 0 ? `$${d.spendUsd}` : '—'}</Text>
            </View>
          ))}
        </View>
      </WidgetCard>

      {/* Monthly Closeout */}
      <WidgetCard
        label="Monthly Closeout"
        headerRight={<GradeBadge grade={data.records.grade} size={34} />}
        onPress={() => onNavigate('/reports')}
      >
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${data.closeout.pct}%` }]} />
        </View>
        <Text style={styles.widgetNote}>
          {data.closeout.pct}% complete · {data.closeout.itemsLeft} items left
        </Text>
      </WidgetCard>

      {/* Truck Health */}
      <WidgetCard
        label="Truck Health"
        headerRight={
          <Text style={styles.widgetValue}>{usd(data.truckHealth.repairsThisMonthUsd)}</Text>
        }
        onPress={() => onNavigate('/reports')}
      >
        <View style={styles.metricRow}>
          <MetricTile
            label="Next PM"
            value={`${data.truckHealth.nextPmInMiles.toLocaleString()} mi`}
          />
          <MetricTile
            label="Repairs"
            value={usd(data.truckHealth.repairsThisMonthUsd)}
            caption="This month"
          />
        </View>
        <Text style={[styles.widgetNote, { marginTop: spacing.sm }]}>
          Last: {data.truckHealth.lastService}
        </Text>
      </WidgetCard>
    </>
  );
}

// ---------------------------------------------------------------------------
// Small pieces
// ---------------------------------------------------------------------------

function QuickActions({ onNavigate }: { onNavigate: (p: TabPath) => void }) {
  // Section 36 quick actions: Check Rate, Scan Rate Con, Scan Receipt, Add Load.
  const actions: { label: string; glyph: string; path: TabPath }[] = [
    { label: 'Check Rate', glyph: '≈', path: '/reports' },
    { label: 'Rate Con', glyph: '⎙', path: '/scan' },
    { label: 'Receipt', glyph: '＋', path: '/scan' },
    { label: 'Add Load', glyph: '▤', path: '/loads' },
  ];
  return (
    <View style={styles.quickRow}>
      {actions.map((a) => (
        <Pressable
          key={a.label}
          accessibilityRole="button"
          accessibilityLabel={a.label}
          onPress={() => onNavigate(a.path)}
          style={({ pressed }) => [styles.quickBtn, pressed && styles.pressed]}
        >
          <Text style={styles.quickGlyph}>{a.glyph}</Text>
          <Text style={styles.quickLabel}>{a.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function StatusChip({ label, value, tone }: { label: string; value: string; tone: Tone }) {
  return (
    <View style={styles.statusChip}>
      <Text style={styles.statusLabel}>{label}</Text>
      <Text style={[styles.statusValue, { color: toneColors[tone].fg }]}>{value}</Text>
    </View>
  );
}

function calTone(tone: 'good' | 'warn' | 'hot' | 'none') {
  switch (tone) {
    case 'good':
      return { borderColor: 'rgba(46, 107, 87, 0.32)', backgroundColor: 'rgba(46, 107, 87, 0.08)' };
    case 'warn':
      return {
        borderColor: 'rgba(200, 145, 45, 0.34)',
        backgroundColor: 'rgba(200, 145, 45, 0.10)',
      };
    case 'hot':
      return { borderColor: 'rgba(169, 74, 59, 0.34)', backgroundColor: 'rgba(169, 74, 59, 0.10)' };
    default:
      return {};
  }
}

const styles = StyleSheet.create({
  root: {
    backgroundColor: colors.background,
    flex: 1,
  },
  content: {
    paddingHorizontal: spacing.xl,
  },
  // header
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.lg,
  },
  logoRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  logoMark: {
    alignItems: 'center',
    backgroundColor: palette.routeGreen,
    borderRadius: radii.sm,
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  logoLetter: {
    color: palette.mapIvory,
    fontFamily: fonts.black,
    fontSize: 20,
    letterSpacing: -1,
  },
  brand: {
    color: colors.text,
    fontFamily: fonts.extrabold,
    fontSize: 16,
    letterSpacing: -0.4,
  },
  headerActions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  iconBtn: {
    alignItems: 'center',
    backgroundColor: 'rgba(30, 35, 39, 0.05)',
    borderRadius: radii.sm,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  iconGlyph: {
    color: colors.text,
    fontSize: 18,
  },
  avatar: {
    alignItems: 'center',
    backgroundColor: colors.surfaceDark,
    borderRadius: radii.sm,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  avatarText: {
    color: colors.textOnDark,
    fontFamily: fonts.black,
    fontSize: 13,
    letterSpacing: -0.5,
  },
  // title
  titleBlock: {
    marginBottom: spacing.md,
  },
  kicker: {
    ...type.label,
    color: colors.textMuted,
    marginBottom: 6,
  },
  headline: {
    ...type.h1,
    color: colors.text,
  },
  // hero
  heroMetric: {
    ...type.metricLg,
    color: colors.textOnDark,
    marginVertical: spacing.sm,
  },
  heroNote: {
    ...type.body,
    color: 'rgba(244, 241, 232, 0.72)',
  },
  metricRow: {
    flexDirection: 'row',
    gap: spacing.sm + 2,
    marginTop: spacing.lg - 2,
  },
  sampleTag: {
    marginTop: spacing.md,
  },
  // status strip
  statusStrip: {
    gap: spacing.sm,
    paddingVertical: spacing.md,
  },
  statusChip: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.sm + 2,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  statusLabel: {
    ...type.labelTiny,
    color: colors.textMuted,
  },
  statusValue: {
    ...type.metricSm,
    color: colors.text,
    marginTop: 2,
  },
  // quick actions
  quickRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  quickBtn: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.sm + 2,
    borderWidth: 1,
    flex: 1,
    gap: 6,
    paddingVertical: spacing.md,
  },
  quickGlyph: {
    color: palette.routeGreen,
    fontFamily: fonts.bold,
    fontSize: 20,
  },
  quickLabel: {
    ...type.labelTiny,
    color: colors.text,
  },
  pressed: {
    opacity: 0.8,
  },
  // widgets
  widgetValue: {
    color: colors.text,
    fontFamily: fonts.extrabold,
    fontSize: 13,
    fontVariant: ['tabular-nums'],
    letterSpacing: -0.3,
  },
  widgetNote: {
    ...type.bodySmall,
    color: colors.textMuted,
  },
  fiRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  fiChip: {
    backgroundColor: 'rgba(46, 107, 87, 0.10)',
    borderRadius: radii.pill,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  fiChipText: {
    ...type.labelTiny,
    color: colors.cta,
  },
  bigNum: {
    color: colors.text,
    fontFamily: fonts.black,
    fontSize: 30,
    fontVariant: ['tabular-nums'],
    letterSpacing: -1.5,
    marginBottom: 4,
  },
  owedRow: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm + 2,
  },
  owedLabel: {
    ...type.body,
    color: colors.text,
    flex: 1,
  },
  owedAmount: {
    ...type.emphasis,
    fontVariant: ['tabular-nums'],
  },
  loadRow: {
    alignItems: 'center',
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    paddingVertical: spacing.sm + 2,
  },
  loadNumber: {
    ...type.emphasis,
    color: colors.text,
  },
  loadRoute: {
    ...type.bodySmall,
    color: colors.textMuted,
    marginTop: 2,
  },
  // calendar
  calRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: spacing.md,
  },
  calCell: {
    alignItems: 'center',
    backgroundColor: 'rgba(30, 35, 39, 0.045)',
    borderColor: 'rgba(30, 35, 39, 0.06)',
    borderRadius: radii.sm,
    borderWidth: 1,
    flex: 1,
    paddingVertical: spacing.sm,
  },
  calDay: {
    color: colors.text,
    fontFamily: fonts.extrabold,
    fontSize: 12,
  },
  calSpend: {
    color: colors.textMuted,
    fontFamily: fonts.medium,
    fontSize: 9,
    marginTop: 2,
  },
  // progress
  progressTrack: {
    backgroundColor: 'rgba(30, 35, 39, 0.08)',
    borderRadius: 999,
    height: 8,
    marginBottom: spacing.sm,
    overflow: 'hidden',
  },
  progressFill: {
    backgroundColor: palette.routeGreen,
    borderRadius: 999,
    height: '100%',
  },
  // states
  centerState: {
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.xl,
  },
  stateCopy: {
    ...type.body,
    color: colors.textMuted,
  },
  skeletonHero: {
    backgroundColor: 'rgba(30, 35, 39, 0.06)',
    borderRadius: radii.md,
    height: 150,
    marginTop: spacing.md,
    width: '100%',
  },
  skeletonRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    width: '100%',
  },
  skeletonTile: {
    backgroundColor: 'rgba(30, 35, 39, 0.06)',
    borderRadius: radii.sm,
    flex: 1,
    height: 72,
  },
  errorCard: {
    marginTop: spacing.md,
  },
  errorTitle: {
    ...type.h2,
    color: colors.text,
  },
  errorCopy: {
    ...type.body,
    color: colors.textMuted,
    marginTop: spacing.sm,
  },
});
