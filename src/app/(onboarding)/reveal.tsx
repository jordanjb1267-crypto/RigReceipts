import { useRouter } from 'expo-router';
import { StyleSheet, Text } from 'react-native';

import { Button, OnboardingShell, Pill, RouteBand } from '@/components';
import { FirstJob, Role, useOnboardingStore } from '@/store/onboarding';
import { colors, spacing, type } from '@/theme';

const ROLE_LABEL: Record<Role, string> = {
  company_driver: 'Company Driver',
  owner_operator: 'Owner-Operator',
  small_fleet: 'Small Fleet',
  hotshot_local: 'Hotshot / Local',
};

const JOB_DONE: Record<FirstJob, { title: string; subtitle: string }> = {
  scan_receipts: { title: 'First receipt captured', subtitle: 'Filed to your expense ledger.' },
  save_load_docs: { title: 'First load doc saved', subtitle: 'Filed to a load folder.' },
  track_money_owed: { title: 'Money owed logged', subtitle: 'Tracking until it is collected.' },
  check_rate: { title: 'Starter RPM target set', subtitle: 'RPM Coach is ready on your board.' },
};

/** O6 · Road board reveal. */
export default function RevealRoute() {
  const router = useRouter();
  const role = useOnboardingStore((s) => s.role);
  const firstJob = useOnboardingStore((s) => s.firstJob);
  const firstActionDone = useOnboardingStore((s) => s.firstActionDone);
  const finishOnboarding = useOnboardingStore((s) => s.finishOnboarding);

  const done = firstJob ? JOB_DONE[firstJob] : null;

  const skipToDashboard = () => {
    finishOnboarding();
    router.replace('/(tabs)');
  };

  return (
    <OnboardingShell
      step={5}
      steps={5}
      footer={
        <>
          <Button label="Go to Dashboard" onPress={() => router.push('/(onboarding)/account')} />
          <Button label="Finish Setup Later" variant="secondary" onPress={skipToDashboard} />
        </>
      }
    >
      {role && <Pill label={ROLE_LABEL[role]} tone="green" />}
      <Text style={styles.title}>Your road board is ready.</Text>
      <Text style={styles.body}>
        Here is what it will track for you. Everything below is one tap from the dashboard.
      </Text>

      {firstActionDone && done && (
        <RouteBand
          marker="✓"
          markerTone="green"
          title={done.title}
          subtitle={done.subtitle}
          value="Done"
        />
      )}
      <RouteBand
        marker="1"
        markerTone="blue"
        title="Capture"
        subtitle="Receipts, BOLs, PODs, lumper, repairs."
        value="Daily"
      />
      <RouteBand
        marker="2"
        markerTone="amber"
        title="Attach"
        subtitle="Link docs and expenses to loads and trucks."
        value="Load"
      />
      <RouteBand
        marker="3"
        markerTone="rust"
        title="Calculate"
        subtitle="Cost per mile, RPM, detention, money owed."
        value="Week"
      />
      <RouteBand
        marker="4"
        markerTone="green"
        title="Close out"
        subtitle="Daily bulletins, weekly grade, monthly report."
        value="Month"
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
});
