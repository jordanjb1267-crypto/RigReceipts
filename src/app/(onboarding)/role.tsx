import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { track } from '@/analytics';
import { Button, ChoiceRow, OnboardingShell } from '@/components';
import { Role, useOnboardingStore } from '@/store/onboarding';
import { colors, spacing, Tone, type } from '@/theme';

const OPTIONS: { role: Role; title: string; subtitle: string; tone: Tone }[] = [
  {
    role: 'owner_operator',
    title: 'Owner-Operator',
    subtitle: 'You own your authority and your truck.',
    tone: 'green',
  },
  {
    role: 'leased_owner_operator',
    title: 'Leased-On Owner-Operator',
    subtitle: 'Your truck, leased to a carrier.',
    tone: 'green',
  },
  {
    role: 'company_driver',
    title: 'Company Driver',
    subtitle: 'You drive; the carrier owns the truck.',
    tone: 'blue',
  },
  {
    role: 'small_fleet',
    title: 'Small Fleet Owner',
    subtitle: 'A handful of trucks and drivers.',
    tone: 'amber',
  },
  {
    role: 'dispatcher_ops',
    title: 'Dispatcher or Operations',
    subtitle: 'You book and manage loads.',
    tone: 'rust',
  },
  {
    role: 'just_starting',
    title: 'Just Getting Started',
    subtitle: 'New to the business.',
    tone: 'neutral',
  },
];

/** O3 · Role selection (Section 27). One-tap; personalizes the experience. */
export default function RoleRoute() {
  const router = useRouter();
  const role = useOnboardingStore((s) => s.role);
  const setRole = useOnboardingStore((s) => s.setRole);

  const pick = (r: Role) => {
    setRole(r);
    track('role_selected', { role: r });
  };

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
      <Text style={styles.title}>How do you run?</Text>
      <Text style={styles.subtitle}>We tune terminology, priorities, and your numbers to fit.</Text>
      <View style={styles.list}>
        {OPTIONS.map((opt, i) => (
          <ChoiceRow
            key={opt.role}
            marker={String(i + 1)}
            markerTone={opt.tone}
            title={opt.title}
            subtitle={opt.subtitle}
            selected={role === opt.role}
            onPress={() => pick(opt.role)}
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
