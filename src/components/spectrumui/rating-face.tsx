import { cn } from "@/lib/utils";
import {
  RATING_COLORS,
  RATING_UNSET_COLOR,
  EYE_SCALE_Y,
  getMouthPath,
} from "@/lib/feedback-face";

export * from "@/lib/feedback-face";

export interface RatingFaceProps {
  /** Rating level from 1 to 5; <= 0 or > 5 renders an unset/neutral face */
  level: number;
  /** Width and height in pixels. Default 32 */
  size?: number;
  /** Custom stroke & fill color. If omitted, uses level color from RATING_COLORS */
  color?: string;
  /** Fill of the face circle. Defaults to "none" (matching the feedback dialog) */
  fill?: string;
  className?: string;
  "aria-label"?: string;
}

/**
 * Static vector face icon matching the Spectrum UI FaceRating widget.
 * Pure SVG rendering without client-side hooks, ideal for both server and client pages.
 */
export function RatingFace({
  level,
  size = 32,
  color,
  fill = "none",
  className,
  "aria-label": ariaLabel,
}: RatingFaceProps) {
  const isUnset = !level || level < 1 || level > 5;
  const clamped = Math.max(1, Math.min(5, Math.round(level || 3)));
  const faceColor = color ?? (isUnset ? RATING_UNSET_COLOR : RATING_COLORS[clamped - 1]);
  const eyeScale = isUnset ? 1 : EYE_SCALE_Y[clamped - 1];
  const showEyebrows = !isUnset && clamped <= 2;
  const mouthD = isUnset ? "M 22 47 Q 36 47 50 47" : getMouthPath(clamped);

  return (
    <svg
      viewBox="0 0 72 72"
      width={size}
      height={size}
      fill="none"
      strokeLinecap="round"
      className={cn("shrink-0 select-none", className)}
      role={ariaLabel ? "img" : "presentation"}
      aria-label={ariaLabel}
      aria-hidden={!ariaLabel}
    >
      {/* Face outline */}
      <circle
        cx={36}
        cy={36}
        r={30}
        strokeWidth={4}
        stroke={faceColor}
        fill={fill}
      />
      {/* Eyebrows (levels 1-2 only) */}
      {showEyebrows && (
        <>
          <line
            x1={19}
            y1={19}
            x2={30}
            y2={23}
            strokeWidth={3}
            stroke={faceColor}
          />
          <line
            x1={42}
            y1={23}
            x2={53}
            y2={19}
            strokeWidth={3}
            stroke={faceColor}
          />
        </>
      )}
      {/* Eyes */}
      <ellipse
        cx={25}
        cy={30}
        rx={3.5}
        ry={4 * eyeScale}
        fill={faceColor}
      />
      <ellipse
        cx={47}
        cy={30}
        rx={3.5}
        ry={4 * eyeScale}
        fill={faceColor}
      />
      {/* Mouth */}
      <path
        strokeWidth={4}
        stroke={faceColor}
        d={mouthD}
      />
    </svg>
  );
}
