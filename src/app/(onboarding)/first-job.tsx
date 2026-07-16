import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { Button, ChoiceRow, OnboardingShell } from '@/components';
import { FirstJob, useOnboardingStore } from '@/store/onboarding';
import { colors, spacing, Tone, type } from '@/theme';

const OPTIONS: { job: FirstJob; title: string; subtitle: string; tone: Tone }[] = [
  {
    job: 'scan_receipts',
    title: 'Scan Receipts',
    subtitle: 'Capture fuel, repairs, and road-life spend.',
    tone: 'green',
  },
  {
    job: 'save_load_docs',
    title: 'Save Load Docs',
    subtitle: 'File BOLs and PODs into a load folder.',
    tone: 'blue',
  },
  {
    job: 'track_money_owed',
    title: 'Track Money Owed',
    subtitle: 'Log detention and lumper reimbursements.',
    tone: 'amber',
  },
  {
    job: 'check_rate',
    title: 'Check My Rate',
    subtitle: 'Find the rate per mile you need to hit.',
    tone: 'rust',
  },
];

/** O4 · First job picker. */
export default function FirstJobRoute() {
  const router = useRouter();
  const firstJob = useOnboardingStore((s) => s.firstJob);
  const setFirstJob = useOnboardingStore((s) => s.setFirstJob);

  return (
    <OnboardingShell
      step={3}
      steps={5}
      footer={
        <Button
          label="Continue"
          disabled={!firstJob}
          onPress={() => router.push('/(onboarding)/first-action')}
        />
      }
    >
      <Text style={styles.title}>What do you want to handle first?</Text>
      <Text style={styles.subtitle}>Pick one — you can do the rest later.</Text>
      <View style={styles.list}>
        {OPTIONS.map((opt, i) => (
          <ChoiceRow
            key={opt.job}
            marker={String(i + 1)}
            markerTone={opt.tone}
            title={opt.title}
            subtitle={opt.subtitle}
            selected={firstJob === opt.job}
            onPress={() => setFirstJob(opt.job)}
          />
        ))}
      </View>
    </OnboardingShell>
  );
}

const styles = StyleSheet.create({
  title: {
    ...type.h1,
    color: colors.text,
  },
  subtitle: {
    ...type.body,
    color: colors.textMuted,
    marginTop: spacing.sm,
  },
  list: {
    gap: spacing.sm + 2,
    marginTop: spacing.xl,
  },
});
