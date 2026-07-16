import { StyleSheet, Text, View } from 'react-native';

import { Card, Pill, RouteBand, Screen } from '@/components';
import { SCAN_TYPES } from '@/domain';
import { palette, radii, spacing, type } from '@/theme';

/**
 * Scan & capture (Loop 3). The camera + OCR pipeline is Phase 6; the canonical
 * scan-type picker is already wired to the domain constants.
 */
export default function ScanScreen() {
  return (
    <Screen
      dark
      kicker="Field Capture"
      title="Scan anything from the road."
      headerRight={<Pill label={`${SCAN_TYPES.length} types`} tone="green" />}
    >
      <View style={styles.chips}>
        {SCAN_TYPES.map((scanType, index) => (
          <View key={scanType.slug} style={[styles.chip, index === 0 && styles.chipActive]}>
            <Text style={[styles.chipLabel, index === 0 && styles.chipLabelActive]}>
              {scanType.label}
            </Text>
          </View>
        ))}
      </View>

      <View style={styles.frame}>
        <View style={[styles.corner, styles.tl]} />
        <View style={[styles.corner, styles.tr]} />
        <View style={[styles.corner, styles.bl]} />
        <View style={[styles.corner, styles.br]} />
        <Text style={styles.frameCopy}>
          Camera capture and OCR land with the scan pipeline (Phase 6). Every scan gets a review
          sheet before anything is saved.
        </Text>
      </View>

      <RouteBand
        dark
        marker="✓"
        markerTone="green"
        title="Capture destinations"
        subtitle="Expense · Fuel log · Maintenance · Load folder · Vault · Reports"
        value="Ready"
      />
      <Card dark compact style={styles.note}>
        <Text style={styles.noteCopy}>
          OCR is never trusted silently — you confirm or edit before a financial record is saved.
        </Text>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  chip: {
    backgroundColor: 'rgba(244, 241, 232, 0.08)',
    borderColor: 'rgba(244, 241, 232, 0.10)',
    borderRadius: radii.pill,
    borderWidth: 1,
    paddingHorizontal: 11,
    paddingVertical: 8,
  },
  chipActive: {
    backgroundColor: palette.routeGreen,
    borderColor: palette.routeGreen,
  },
  chipLabel: {
    color: 'rgba(244, 241, 232, 0.72)',
    fontFamily: type.emphasis.fontFamily,
    fontSize: 11,
  },
  chipLabelActive: {
    color: palette.mapIvory,
  },
  frame: {
    alignItems: 'center',
    backgroundColor: palette.asphalt2,
    borderColor: 'rgba(244, 241, 232, 0.15)',
    borderRadius: radii.lg,
    borderWidth: 1,
    height: 300,
    justifyContent: 'center',
    marginTop: spacing.lg,
    padding: spacing.xxl,
  },
  frameCopy: {
    ...type.body,
    color: 'rgba(244, 241, 232, 0.6)',
    textAlign: 'center',
  },
  corner: {
    borderColor: palette.routeGreen,
    height: 44,
    position: 'absolute',
    width: 44,
  },
  tl: { borderLeftWidth: 3, borderTopLeftRadius: radii.sm, borderTopWidth: 3, left: 22, top: 22 },
  tr: {
    borderRightWidth: 3,
    borderTopRightRadius: radii.sm,
    borderTopWidth: 3,
    right: 22,
    top: 22,
  },
  bl: {
    borderBottomLeftRadius: radii.sm,
    borderBottomWidth: 3,
    borderLeftWidth: 3,
    bottom: 22,
    left: 22,
  },
  br: {
    borderBottomRightRadius: radii.sm,
    borderBottomWidth: 3,
    borderRightWidth: 3,
    bottom: 22,
    right: 22,
  },
  note: {
    marginTop: spacing.md,
  },
  noteCopy: {
    ...type.bodySmall,
    color: 'rgba(244, 241, 232, 0.62)',
  },
});
