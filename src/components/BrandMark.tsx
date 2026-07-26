import Svg, { Path } from 'react-native-svg';

import { colors, palette } from '@/theme';

interface BrandMarkProps {
  /** Height in points (width = height × 0.8125). Default 28 (tab header). */
  size?: number;
  /** Mark color. Ivory on dark surfaces (default), Asphalt Charcoal on ivory. */
  ink?: string;
  /** The surface the mark sits on, so the dashed centerline reads as a road gap. */
  canvas?: string;
  /** Override the leg hue. By default it follows the size rule below. */
  legFill?: string;
}

/**
 * The RigReceipts road-stem "R" (handoff README · Logo & brand mark). The stem is
 * a road in slight perspective carrying a dashed centerline; the leg is a plane.
 *
 * Two rules the review caught:
 *  - The leg is Route Green at ≥40pt but `ink` below — a green leg drops out of
 *    the silhouette at header size and the mark reads as a "P".
 *  - The dash weight scales inversely with size, and below 25pt the centerline is
 *    dropped entirely.
 */
export function BrandMark({ size = 28, ink, canvas, legFill }: BrandMarkProps) {
  const inkColor = ink ?? colors.text;
  const canvasColor = canvas ?? colors.background;
  const leg = legFill ?? (size >= 40 ? palette.routeGreen : inkColor);

  // Dash weight: 3.6 @64 → 5.4 @25 (heavier at small sizes or it disappears).
  const dash = size >= 64 ? 3.6 : size <= 25 ? 5.4 : 5.4 - ((size - 25) * (5.4 - 3.6)) / (64 - 25);
  const showCenterline = size >= 25;

  return (
    <Svg width={size * 0.8125} height={size} viewBox="0 0 104 128">
      {/* leg */}
      <Path d="M40 56h36l28 68H68z" fill={leg} />
      {/* road stem */}
      <Path d="M18 4h20l2 120H6z" fill={inkColor} />
      {/* bowl + counter */}
      <Path
        d="M34 4h30a22 22 0 0 1 22 22v14a22 22 0 0 1-22 22H34zm0 18h25a11 11 0 0 1 0 22H34z"
        fill={inkColor}
        fillRule="evenodd"
      />
      {/* dashed centerline, drawn last so it reads as a gap in the road */}
      {showCenterline && (
        <Path
          d="M28 14 23 114"
          stroke={canvasColor}
          strokeWidth={dash}
          strokeDasharray="10,9"
          strokeLinecap="round"
          fill="none"
        />
      )}
    </Svg>
  );
}
