import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { track } from '@/analytics';
import { BrandMark, TopoBackground } from '@/components';
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
      <TopoBackground opacity={0.08} />
      <View style={[styles.center, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <View style={styles.tile}>
          <BrandMark size={64} ink={palette.mapIvory} canvas={palette.asphaltCharcoal} />
        </View>
        <Text style={styles.wordmark}>
          Rig<Text style={styles.wordmarkAccent}>Receipts</Text>
        </Text>
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
    backgroundColor: colors.background,
    flex: 1,
  },
  center: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  tile: {
    alignItems: 'center',
    backgroundColor: palette.asphaltCharcoal,
    borderColor: 'rgba(244, 241, 232, 0.14)',
    borderRadius: 26,
    borderWidth: 1,
    height: 96,
    justifyContent: 'center',
    marginBottom: spacing.xl,
    width: 96,
  },
  wordmark: {
    color: colors.text,
    fontFamily: fonts.black,
    fontSize: 38,
    letterSpacing: -1.8,
  },
  wordmarkAccent: {
    color: palette.goodLight,
  },
  subtitle: {
    color: colors.text,
    fontFamily: fonts.extrabold,
    fontSize: 20,
    letterSpacing: -0.6,
    marginTop: spacing.md,
    paddingHorizontal: spacing.lg,
    textAlign: 'center',
  },
  tagline: {
    ...type.body,
    color: colors.textMuted,
    marginTop: spacing.lg,
    textAlign: 'center',
  },
  hint: {
    ...type.label,
    alignSelf: 'center',
    color: colors.textFaint,
    position: 'absolute',
  },
});
