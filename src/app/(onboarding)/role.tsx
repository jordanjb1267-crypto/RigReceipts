import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { Button, ChoiceRow, OnboardingShell } from '@/components';
import { Role, useOnboardingStore } from '@/store/onboarding';
import { colors, spacing, Tone, type } from '@/theme';

const OPTIONS: { role: Role; title: string; subtitle: string; tone: Tone }[] = [
  {
    role: 'owner_operator',
    title: 'Owner-Operator',
    subtitle: 'Cost per mile, RPM targets, monthly reports.',
    tone: 'green',
  },
  {
    role: 'company_driver',
    title: 'Company Driver',
    subtitle: 'Receipts, lumper reimbursement, BOLs, detention owed.',
    tone: 'blue',
  },
  {
    role: 'small_fleet',
    title: 'Small Fleet',
    subtitle: 'Per-truck expenses, documents, and performance.',
    tone: 'amber',
  },
  {
    role: 'hotshot_local',
    title: 'Hotshot / Local',
    subtitle: 'Simple expense, mileage, and closeout tracking.',
    tone: 'rust',
  },
];

/** O3 · Role setup. */
export default function RoleRoute() {
  const router = useRouter();
  const role = useOnboardingStore((s) => s.role);
  const setRole = useOnboardingStore((s) => s.setRole);

  return (
    <OnboardingShell
      step={2}
      steps={5}
      footer={
        <Button
          label="Continue"
          disabled={!role}
          onPress={() => router.push('/(onboarding)/first-job')}
        />
      }
    >
      <Text style={styles.title}>What are you running?</Text>
      <Text style={styles.subtitle}>We tune the road board to how you work.</Text>
      <View style={styles.list}>
        {OPTIONS.map((opt, i) => (
          <ChoiceRow
            key={opt.role}
            marker={String(i + 1)}
            markerTone={opt.tone}
            title={opt.title}
            subtitle={opt.subtitle}
            selected={role === opt.role}
            onPress={() => setRole(opt.role)}
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
