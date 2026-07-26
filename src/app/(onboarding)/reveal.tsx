import { useRouter } from 'expo-router';
import { StyleSheet, Text } from 'react-native';

import { track } from '@/analytics';
import { Button, Card, OnboardingShell, Pill, RouteBand } from '@/components';
import { useOnboardingStore } from '@/store/onboarding';
import { colors, palette, spacing, type } from '@/theme';

/** O6 · Road Board reveal (Section 35). */
export default function RevealRoute() {
  const router = useRouter();
  const finishOnboarding = useOnboardingStore((s) => s.finishOnboarding);

  const goToBoard = () => {
    track('road_board_revealed', {});
    // Offer the optional account step before the board (never forced).
    router.push('/(onboarding)/account');
  };

  const skip = () => {
    track('road_board_revealed', {});
    finishOnboarding();
    router.replace('/(tabs)');
  };

  return (
    <OnboardingShell
      step={5}
      steps={5}
      footer={
        <>
          <Button label="Go to My Road Board" onPress={goToBoard} />
          <Button label="Finish Setup Later" variant="secondary" onPress={skip} />
        </>
      }
    >
      <Pill label="Ready" tone="green" />
      <Text style={styles.title}>This is your Road Board.</Text>
      <Text style={styles.body}>
        Your loads, miles, expenses, rates, and money — all in one place.
      </Text>

      <Card style={styles.saved}>
        <Text style={styles.savedTag}>✓ Already on your board</Text>
        <Text style={styles.savedCopy}>
          The load you just checked is saved — its rate, miles, and profit verdict are waiting on the
          board.
        </Text>
      </Card>

      <RouteBand
        marker="1"
        markerTone="green"
        title="This Week"
        subtitle="Revenue, expenses, and your current operating position."
        value="Now"
      />
      <RouteBand
        marker="2"
        markerTone="blue"
        title="Freight Intelligence"
        subtitle="Check rates, brokers, and recent community lane activity."
        value="Rates"
      />
      <RouteBand
        marker="3"
        markerTone="amber"
        title="Next Best Action"
        subtitle="See what needs attention next."
        value="Do"
      />
    </OnboardingShell>
  );
}

const styles = StyleSheet.create({
  title: {
    ...type.h1,
    color: colors.text,
    marginTop: spacing.lg,
  },
  body: {
    ...type.body,
    color: colors.textMuted,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  saved: {
    backgroundColor: 'rgba(46, 107, 87, 0.14)',
    borderColor: 'rgba(46, 107, 87, 0.4)',
    marginBottom: spacing.xs,
    marginTop: spacing.sm,
  },
  savedTag: {
    ...type.label,
    color: palette.goodLight,
  },
  savedCopy: {
    ...type.bodySmall,
    color: colors.textMuted,
    marginTop: spacing.xs,
  },
});

