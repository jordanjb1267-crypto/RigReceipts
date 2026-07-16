import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { Button, OnboardingShell, Pill } from '@/components';
import { colors, palette, spacing, type } from '@/theme';

const STAGES = ['Receipts', 'Loads', 'Miles', 'Profit'];

/** O2 · Value hook. */
export default function ValueRoute() {
  const router = useRouter();

  return (
    <OnboardingShell
      step={1}
      steps={5}
      footer={
        <>
          <Button label="Start Tracking" onPress={() => router.push('/(onboarding)/role')} />
          <Button
            label="Scan First Receipt"
            variant="secondary"
            onPress={() => router.push('/(onboarding)/role')}
          />
        </>
      }
    >
      <Pill label="Industrial Atlas" tone="green" />
      <Text style={styles.headline}>Know what every mile is costing you.</Text>
      <Text style={styles.body}>
        Track receipts, fuel, repairs, BOLs, detention, lumper fees, and rate-per-mile in one place.
      </Text>

      <View style={styles.route}>
        {STAGES.map((stage, i) => (
          <View key={stage} style={styles.stage}>
            <View style={styles.node}>
              <Text style={styles.nodeLabel}>{i + 1}</Text>
            </View>
            <Text style={styles.stageLabel}>{stage}</Text>
            {i < STAGES.length - 1 && <View style={styles.connector} />}
          </View>
        ))}
      </View>
    </OnboardingShell>
  );
}

const styles = StyleSheet.create({
  headline: {
    ...type.h1,
    color: colors.text,
    marginTop: spacing.lg,
  },
  body: {
    ...type.body,
    color: colors.textMuted,
    marginTop: spacing.md,
  },
  route: {
    flexDirection: 'row',
    marginTop: spacing.xxl,
  },
  stage: {
    alignItems: 'center',
    flex: 1,
    position: 'relative',
  },
  node: {
    alignItems: 'center',
    backgroundColor: palette.routeGreen,
    borderRadius: 14,
    height: 34,
    justifyContent: 'center',
    width: 34,
    zIndex: 2,
  },
  nodeLabel: {
    color: palette.mapIvory,
    fontFamily: type.emphasis.fontFamily,
    fontSize: 13,
  },
  stageLabel: {
    ...type.labelTiny,
    color: colors.text,
    marginTop: spacing.sm,
  },
  connector: {
    backgroundColor: colors.hairline,
    height: 2,
    left: '50%',
    position: 'absolute',
    right: '-50%',
    top: 16,
    zIndex: 1,
  },
});
