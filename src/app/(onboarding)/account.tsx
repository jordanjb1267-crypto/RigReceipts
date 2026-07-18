import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { track } from '@/analytics';
import { Button, OnboardingShell, Pill, RouteBand } from '@/components';
import { bootstrapProfile, emailLooksValid } from '@/data/profile';
import { getSupabaseClient, isSupabaseConfigured } from '@/lib/supabase';
import { useOnboardingStore } from '@/store/onboarding';
import { colors, spacing, type } from '@/theme';

type Stage = 'choose' | 'email' | 'code' | 'error';

/**
 * O7 · Optional account setup (Section 37). Email OTP — no deep links needed.
 * Never forced: "Keep Using This Device" always works, and any auth failure
 * falls back to device mode without blocking onboarding.
 */
export default function AccountRoute() {
  const router = useRouter();
  const finishOnboarding = useOnboardingStore((s) => s.finishOnboarding);
  const setAccountMode = useOnboardingStore((s) => s.setAccountMode);
  const role = useOnboardingStore((s) => s.role);

  const [stage, setStage] = useState<Stage>('choose');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorText, setErrorText] = useState('');

  const finishAsDevice = () => {
    setAccountMode('device');
    finishOnboarding();
    router.replace('/(tabs)');
  };

  const sendCode = async () => {
    setBusy(true);
    setErrorText('');
    try {
      const { error } = await getSupabaseClient().auth.signInWithOtp({
        email: email.trim(),
        options: { shouldCreateUser: true },
      });
      if (error) throw error;
      setStage('code');
    } catch (e) {
      setErrorText(e instanceof Error ? e.message : 'Could not send the code.');
      setStage('error');
    } finally {
      setBusy(false);
    }
  };

  const verifyCode = async () => {
    setBusy(true);
    setErrorText('');
    try {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase.auth.verifyOtp({
        email: email.trim(),
        token: code.trim(),
        type: 'email',
      });
      if (error) throw error;
      const userId = data.session?.user.id;
      if (userId) {
        // Best-effort bootstrap; a failure here must not block onboarding.
        try {
          await bootstrapProfile(userId, role);
        } catch {
          /* rows are re-upserted on next app start */
        }
      }
      track('account_created', { method: 'email_otp' });
      setAccountMode('account');
      finishOnboarding();
      router.replace('/(tabs)');
    } catch (e) {
      setErrorText(e instanceof Error ? e.message : 'That code did not work.');
    } finally {
      setBusy(false);
    }
  };

  if (stage === 'email' || stage === 'code' || stage === 'error') {
    const onCodeStage = stage === 'code';
    return (
      <OnboardingShell
        footer={
          <>
            {stage === 'error' ? (
              <Button label="Try Again" onPress={() => setStage('email')} />
            ) : onCodeStage ? (
              <Button
                label="Verify & Create Account"
                disabled={code.trim().length < 6}
                loading={busy}
                onPress={verifyCode}
              />
            ) : (
              <Button
                label="Email Me a Code"
                disabled={!emailLooksValid(email)}
                loading={busy}
                onPress={sendCode}
              />
            )}
            <Button label="Keep Using This Device" variant="secondary" onPress={finishAsDevice} />
          </>
        }
      >
        <Pill label="Free account" tone="green" />
        <Text style={styles.title}>
          {onCodeStage ? 'Check your email.' : 'Save your Road Board.'}
        </Text>
        <Text style={styles.body}>
          {onCodeStage
            ? `We sent a 6-digit code to ${email.trim()}. Enter it below.`
            : 'Create an account to keep your loads, Rate Checks, receipts, and lane history backed up.'}
        </Text>

        {stage === 'error' && errorText !== '' && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{errorText}</Text>
          </View>
        )}

        {stage !== 'error' && (
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>{onCodeStage ? '6-digit code' : 'Email'}</Text>
            {onCodeStage ? (
              <TextInput
                value={code}
                onChangeText={(v) => setCode(v.replace(/[^0-9]/g, ''))}
                keyboardType="number-pad"
                maxLength={6}
                autoFocus
                style={styles.input}
                placeholder="000000"
                placeholderTextColor="rgba(30,35,39,0.3)"
              />
            ) : (
              <TextInput
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                autoFocus
                style={styles.input}
                placeholder="you@example.com"
                placeholderTextColor="rgba(30,35,39,0.3)"
              />
            )}
            {onCodeStage && errorText !== '' && <Text style={styles.inlineError}>{errorText}</Text>}
          </View>
        )}
      </OnboardingShell>
    );
  }

  return (
    <OnboardingShell
      footer={
        <>
          <Button
            label="Continue with Email"
            onPress={() => {
              if (!isSupabaseConfigured()) {
                // No backend configured (dev build without .env) — device mode.
                finishAsDevice();
                return;
              }
              setStage('email');
            }}
          />
          <Button label="Keep Using This Device" variant="secondary" onPress={finishAsDevice} />
        </>
      }
    >
      <Text style={styles.title}>Save your Road Board.</Text>
      <Text style={styles.body}>
        Create an account to keep your loads, Rate Checks, receipts, and lane history backed up. No
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
      <Text style={styles.note}>
        Apple and Google sign-in arrive with the store builds; email works everywhere today.
      </Text>
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
  note: {
    ...type.bodySmall,
    color: colors.textMuted,
    marginTop: spacing.lg,
  },
  field: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 14,
    borderWidth: 1,
    marginTop: spacing.xl,
    padding: spacing.lg,
  },
  fieldLabel: {
    ...type.labelTiny,
    color: colors.textMuted,
    marginBottom: 6,
  },
  input: {
    color: colors.text,
    fontFamily: type.metricSm.fontFamily,
    fontSize: 20,
    letterSpacing: 0.5,
    padding: 0,
  },
  inlineError: {
    ...type.bodySmall,
    color: colors.danger,
    marginTop: spacing.sm,
  },
  errorBox: {
    backgroundColor: 'rgba(169, 74, 59, 0.08)',
    borderColor: 'rgba(169, 74, 59, 0.22)',
    borderRadius: 14,
    borderWidth: 1,
    marginTop: spacing.lg,
    padding: spacing.md,
  },
  errorText: {
    ...type.bodySmall,
    color: colors.text,
  },
});
