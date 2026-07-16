import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { Button, OnboardingShell, RouteBand } from '@/components';
import { useOnboardingStore } from '@/store/onboarding';
import { colors, spacing, type } from '@/theme';

/**
 * O7 · Optional account setup. Only reached after value is created, and never
 * forces account creation (real auth arrives in Phase 3). Both paths finish
 * onboarding and land on the dashboard.
 */
export default function AccountRoute() {
  const router = useRouter();
  const finishOnboarding = useOnboardingStore((s) => s.finishOnboarding);
  const setAccountMode = useOnboardingStore((s) => s.setAccountMode);

  const finish = (mode: 'account' | 'device') => {
    setAccountMode(mode);
    finishOnboarding();
    router.replace('/(tabs)');
  };

  return (
    <OnboardingShell
      footer={
        <>
          <Button label="Create Free Account" onPress={() => finish('account')} />
          <Button
            label="Keep Using This Device"
            variant="secondary"
            onPress={() => finish('device')}
          />
        </>
      }
    >
      <Text style={styles.title}>Save your records?</Text>
      <Text style={styles.body}>
        A free account backs up your receipts and loads so they survive a lost or upgraded phone. No
        paywall — you can do this anytime.
      </Text>

      <View style={styles.list}>
        <RouteBand
          marker="↑"
          markerTone="green"
          title="Backed up"
          subtitle="Records sync and restore across devices."
          value="Account"
        />
        <RouteBand
          marker="◷"
          markerTone="blue"
          title="Local only"
          subtitle="Everything stays on this device for now."
          value="Device"
        />
      </View>
    </OnboardingShell>
  );
}

const styles = StyleSheet.create({
  title: {
    ...type.h1,
    color: colors.text,
  },
  body: {
    ...type.body,
    color: colors.textMuted,
    marginTop: spacing.md,
  },
  list: {
    marginTop: spacing.lg,
  },
});
