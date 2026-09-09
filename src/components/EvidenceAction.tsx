import { StyleSheet, Text, View } from 'react-native';

import { colors, spacing, type } from '@/theme';

import { Button } from './Button';

interface EvidenceActionProps {
  label: string;
  hint?: string;
  onPress: () => void;
  disabled?: boolean;
  variant?: 'primary' | 'secondary';
}

/**
 * Explicit confirmation / evidence step. Never implies an external send.
 */
export function EvidenceAction({
  label,
  hint = 'You confirm before anything is saved. Nothing is sent externally.',
  onPress,
  disabled,
  variant = 'primary',
}: EvidenceActionProps) {
  return (
    <View style={styles.wrap}>
      <Button label={label} onPress={onPress} disabled={disabled} variant={variant} />
      <Text style={styles.hint}>{hint}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm, marginTop: spacing.md },
  hint: { ...type.bodySmall, color: colors.textMuted },
});
