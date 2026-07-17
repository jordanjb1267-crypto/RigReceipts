import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { Button, OnboardingShell, Pill } from '@/components';
import { colors, palette, spacing, type } from '@/theme';

const WATERFALL = [
  { value: '$2.95', label: 'Loaded RPM', tone: palette.highwayBlue },
  { value: '$2.38', label: 'All-Mile RPM', tone: palette.fuelAmber },
  { value: '$0.46', label: 'Above Your Target', tone: palette.routeGreen },
];

/** O2 · Primary value (Section 26). */
export default function ValueRoute() {
  const router = useRouter();

  return (
    <OnboardingShell
      step={1}
      steps={5}
      footer={
        <>
          <Button label="Check a Load" onPress={() => router.push('/(onboarding)/role')} />
          <Button
            label="See What Else RigReceipts Does"
            variant="secondary"
            onPress={() => router.push('/(onboarding)/role')}
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
});
