import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { track } from '@/analytics';
import { TopoBackground } from '@/components';
import { colors, fonts, palette, spacing, type } from '@/theme';

/** O1 · Splash / brand load. Tap anywhere to continue. */
export default function SplashRoute() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  useEffect(() => {
    track('onboarding_started', {});
  }, []);

  return (
    <Pressable style={styles.root} onPress={() => router.push('/(onboarding)/value')}>
      <TopoBackground onDark opacity={0.1} />
      <View style={[styles.center, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <View style={styles.mark}>
          <Text style={styles.markLetter}>R</Text>
        </View>
        <Text style={styles.wordmark}>RigReceipts</Text>
        <Text style={styles.subtitle}>Know what the load really pays.</Text>
        <Text style={styles.tagline}>
          Rates, receipts, miles, and real profit — built for the driver.
        </Text>
      </View>
      <Text style={[styles.hint, { bottom: insets.bottom + spacing.xl }]}>Tap to start</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    backgroundColor: colors.surfaceDark,
    flex: 1,
  },
  center: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  mark: {
    alignItems: 'center',
    backgroundColor: palette.routeGreen,
    borderRadius: 22,
    height: 84,
    justifyContent: 'center',
    marginBottom: spacing.xl,
    width: 84,
  },
  markLetter: {
    color: palette.mapIvory,
    fontFamily: fonts.black,
    fontSize: 48,
    letterSpacing: -3,
  },
  wordmark: {
    color: colors.textOnDark,
    fontFamily: fonts.black,
    fontSize: 36,
    letterSpacing: -1.5,
  },
  subtitle: {
    color: colors.textOnDark,
    fontFamily: fonts.extrabold,
    fontSize: 20,
    letterSpacing: -0.6,
    marginTop: spacing.md,
    paddingHorizontal: spacing.lg,
    textAlign: 'center',
  },
  tagline: {
    ...type.body,
    color: 'rgba(244, 241, 232, 0.55)',
    marginTop: spacing.lg,
    textAlign: 'center',
  },
  hint: {
    ...type.label,
    alignSelf: 'center',
    color: 'rgba(244, 241, 232, 0.5)',
    position: 'absolute',
  },
});
