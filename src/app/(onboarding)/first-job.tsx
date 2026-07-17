import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { track } from '@/analytics';
import { Button, ChoiceRow, OnboardingShell } from '@/components';
import { isFeatureEnabled } from '@/config/flags';
import { FirstJob, useOnboardingStore } from '@/store/onboarding';
import { colors, spacing, Tone, type } from '@/theme';

interface JobOption {
  job: FirstJob;
  title: string;
  subtitle: string;
  tone: Tone;
  badge?: string;
  /** When set, the option only shows if the flag is enabled. */
  requiresFlag?: Parameters<typeof isFeatureEnabled>[0];
}

const OPTIONS: JobOption[] = [
  {
    job: 'check_rate',
    title: 'Check My Rate',
    subtitle: 'See whether a load clears your break-even and target.',
    tone: 'green',
    badge: 'Best Place to Start',
  },
  {
    job: 'scan_rate_con',
    title: 'Scan a Rate Confirmation',
    subtitle: 'Pull the rate, route, and miles into a load automatically.',
    tone: 'blue',
    requiresFlag: 'freight_intelligence_enabled',
  },
  {
    job: 'scan_receipt',
    title: 'Scan a Receipt',
    subtitle: 'Save fuel, tolls, repairs, and other expenses.',
    tone: 'amber',
  },
  {
    job: 'track_miles',
    title: 'Track My Miles',
    subtitle: 'Record loaded, deadhead, and business mileage.',
    tone: 'rust',
  },
  {
    job: 'organize_load',
    title: 'Organize a Load',
    subtitle: 'Keep the rate confirmation, receipts, and trip details together.',
    tone: 'neutral',
  },
  {
    job: 'see_community_rates',
    title: 'See Community Rates',
    subtitle: 'View recent driver-shared rates by lane and equipment.',
    tone: 'blue',
    requiresFlag: 'community_rate_board_enabled',
  },
];

/** O4 · First-job picker (Section 28). */
export default function FirstJobRoute() {
  const router = useRouter();
  const firstJob = useOnboardingStore((s) => s.firstJob);
  const setFirstJob = useOnboardingStore((s) => s.setFirstJob);

  const visible = OPTIONS.filter((o) => !o.requiresFlag || isFeatureEnabled(o.requiresFlag));

  const pick = (job: FirstJob) => {
    setFirstJob(job);
    track('first_job_selected', { first_job: job });
  };

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
      <Text style={styles.title}>What do you need right now?</Text>
      <Text style={styles.subtitle}>Pick one — you can do the rest anytime.</Text>
      <View style={styles.list}>
        {visible.map((opt, i) => (
          <ChoiceRow
            key={opt.job}
            marker={String(i + 1)}
            markerTone={opt.tone}
            title={opt.title}
            subtitle={opt.subtitle}
            badge={opt.badge}
            selected={firstJob === opt.job}
            onPress={() => pick(opt.job)}
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
