import { StyleSheet, View } from 'react-native';
import Svg, { G, Path } from 'react-native-svg';

import { palette } from '@/theme';

interface TopoBackgroundProps {
  /** Stroke opacity — keep subtle and functional (spec: §2 background language). */
  opacity?: number;
  /** Light strokes for dark screens. */
  onDark?: boolean;
}

/** Contour paths lifted from the Industrial Atlas mockup's 360×360 topo tile. */
const CONTOUR_PATHS = [
  'M-5 42c44-30 85-28 126 1 45 32 86 29 131-4 38-27 74-27 111 0',
  'M-10 96c48-23 89-17 125 19 42 41 87 40 134-2 37-33 75-35 116-5',
  'M6 152c44-27 88-24 134 10 38 28 75 25 113-9 39-35 76-38 113-8',
  'M-14 218c42-23 84-11 126 35 35 39 74 38 117-2 48-45 93-43 135 6',
  'M19 286c53-24 94-12 123 38 21 36 57 44 108 24 44-18 82-13 116 15',
  'M58-8c-8 56 4 102 36 137 35 38 42 82 21 133-22 52-12 96 30 132',
  'M175-6c6 50 27 90 62 119 34 28 50 64 47 108-4 56 16 102 60 139',
];

/**
 * Subtle atlas/topography backdrop. Absolutely fills its parent;
 * never intercepts touches.
 */
export function TopoBackground({ opacity = 0.12, onDark = false }: TopoBackgroundProps) {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Svg
        height="100%"
        width="100%"
        viewBox="0 0 360 360"
        preserveAspectRatio="xMidYMid slice"
        opacity={opacity}
      >
        <G fill="none" stroke={onDark ? palette.mapIvory : palette.deepSlate} strokeWidth={1}>
          {CONTOUR_PATHS.map((d) => (
            <Path key={d} d={d} />
          ))}
        </G>
      </Svg>
    </View>
  );
}
