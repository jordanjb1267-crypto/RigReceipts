import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, OnboardingShell, Pill, RouteBand } from '@/components';
import { colors, palette, radii, spacing, Tone, type } from '@/theme';

const WATERFALL = [
  { value: '$2.95', label: 'Loaded RPM', tone: palette.highwayBlue },
  { value: '$2.38', label: 'All-Mile RPM', tone: palette.fuelAmber },
  { value: '$0.46', label: 'Above Your Target', tone: palette.routeGreen },
];

const WHAT_ELSE: { marker: string; tone: Tone; title: string; subtitle: string }[] = [
  {
    marker: '$',
    tone: 'green',
    title: 'Rate Checks',
    subtitle: 'See whether a load clears your break-even and target before you accept it.',
  },
  {
    marker: '▤',
    tone: 'amber',
    title: 'Receipts',
    subtitle: 'Scan fuel, tolls, repairs, and expenses — read on-device, confirmed by you.',
  },
  {
    marker: '◎',
    tone: 'rust',
    title: 'Miles',
    subtitle: 'Track loaded, deadhead, and business miles so RPM reflects reality.',
  },
  {
    marker: '▦',
    tone: 'blue',
    title: 'Loads',
    subtitle: 'Keep the rate confirmation, receipts, and trip details in one packet.',
  },
  {
    marker: '↗',
    tone: 'green',
    title: 'Community Rates',
    subtitle: 'Recent driver-shared rates by lane and equipment — historical, not load listings.',
  },
];

/** O2 · Primary value (Section 26). */
export default function ValueRoute() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [sheetOpen, setSheetOpen] = useState(false);

  const goToRole = () => router.push('/(onboarding)/role');

  return (
    <OnboardingShell
      step={1}
      steps={5}
      footer={
        <>
          <Button label="Check a Load" onPress={goToRole} />
          <Button
            label="See What Else RigReceipts Does"
            variant="secondary"
            onPress={() => setSheetOpen(true)}
          />
        </>
      }
    >
      <Pill label="Freight Intelligence" tone="green" />
      <Text style={styles.headline}>A good loaded rate can still be a bad load.</Text>
      <Text style={styles.body}>
        RigReceipts calculates what is left after deadhead, fuel, and your operating costs.
      </Text>

      <View style={styles.waterfall}>
        {WATERFALL.map((step, i) => (
          <View key={step.label}>
            <View style={[styles.stepCard, { borderLeftColor: step.tone }]}>
              <Text style={styles.stepValue}>{step.value}</Text>
              <Text style={styles.stepLabel}>{step.label}</Text>
            </View>
            {i < WATERFALL.length - 1 && <Text style={styles.arrow}>↓</Text>}
          </View>
        ))}
      </View>

      <Modal
        visible={sheetOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setSheetOpen(false)}
      >
        <Pressable style={styles.backdrop} onPress={() => setSheetOpen(false)} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>Everything on one Road Board</Text>
          <Text style={styles.sheetSub}>
            One place to judge a load, then track the miles and money that make the answer sharper.
          </Text>
          <View style={styles.sheetList}>
            {WHAT_ELSE.map((row) => (
              <RouteBand
                key={row.title}
                marker={row.marker}
                markerTone={row.tone}
                title={row.title}
                subtitle={row.subtitle}
              />
            ))}
          </View>
          <Button
            label="Check a Load"
            onPress={() => {
              setSheetOpen(false);
              goToRole();
            }}
          />
        </View>
      </Modal>
    </OnboardingShell>
  );
}

const styles = StyleSheet.create({
  headline: {
    ...type.h1,
    color: colors.text,
    marginTop: spacing.lg,
  },
  body: {
    ...type.body,
    color: colors.textMuted,
    marginTop: spacing.md,
  },
  waterfall: {
    marginTop: spacing.xl,
  },
  stepCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderLeftWidth: 4,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  stepValue: {
    color: colors.text,
    fontFamily: type.metric.fontFamily,
    fontSize: 26,
    fontVariant: ['tabular-nums'],
    letterSpacing: -1,
  },
  stepLabel: {
    ...type.labelTiny,
    color: colors.textMuted,
    marginTop: 2,
  },
  arrow: {
    alignSelf: 'center',
    color: colors.textMuted,
    fontSize: 18,
    paddingVertical: 4,
  },
  // "what else" sheet
  backdrop: {
    backgroundColor: 'rgba(30, 35, 39, 0.4)',
    flex: 1,
  },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
  },
  sheetHandle: {
    alignSelf: 'center',
    backgroundColor: colors.hairline,
    borderRadius: 999,
    height: 4,
    marginBottom: spacing.lg,
    width: 40,
  },
  sheetTitle: {
    ...type.h2,
    color: colors.text,
  },
  sheetSub: {
    ...type.bodySmall,
    color: colors.textMuted,
    marginTop: spacing.xs,
  },
  sheetList: {
    marginBottom: spacing.md,
    marginTop: spacing.sm,
  },
});
