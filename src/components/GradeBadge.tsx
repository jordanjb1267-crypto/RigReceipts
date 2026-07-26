import { StyleSheet, Text, View, ViewStyle } from 'react-native';

import { fonts, markerFills, Tone } from '@/theme';

interface GradeBadgeProps {
  /** Letter grade: A, A-, B+, … F */
  grade: string;
  size?: number;
  style?: ViewStyle;
}

const toneForGrade = (grade: string): Tone => {
  const letter = grade.charAt(0).toUpperCase();
  if (letter === 'A') return 'green';
  if (letter === 'B') return 'blue';
  if (letter === 'C') return 'amber';
  return 'rust';
};

/** Weekly/monthly grade badge. Grades coach, not shame — tone stays matter-of-fact. */
export function GradeBadge({ grade, size = 44, style }: GradeBadgeProps) {
  const fill = markerFills[toneForGrade(grade)];
  return (
    <View
      accessibilityLabel={`Grade ${grade}`}
      style={[
        styles.badge,
        {
          backgroundColor: fill.bg,
          borderRadius: size * 0.36,
          height: size,
          width: size,
        },
        style,
      ]}
    >
      <Text style={[styles.grade, { color: fill.fg, fontSize: size * 0.42 }]}>{grade}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  grade: {
    fontFamily: fonts.black,
    letterSpacing: -1,
  },
});
