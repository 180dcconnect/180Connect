import { z } from "zod";

/**
 * Accessibility Settings (F205).
 *
 * Allows users to adjust text readability, typography scale, contrast,
 * line spacing, and animation motion across the entire platform.
 */

export const FONT_SIZES = ["normal", "large", "extra-large"] as const;
export type FontSize = (typeof FONT_SIZES)[number];

export const CONTRAST_MODES = ["normal", "high"] as const;
export type ContrastMode = (typeof CONTRAST_MODES)[number];

export const LINE_SPACINGS = ["normal", "relaxed"] as const;
export type LineSpacing = (typeof LINE_SPACINGS)[number];

export const REDUCED_MOTIONS = ["normal", "reduced"] as const;
export type ReducedMotion = (typeof REDUCED_MOTIONS)[number];

export const COOKIE_FONT_SIZE = "accessibility_font_size";
export const COOKIE_CONTRAST = "accessibility_contrast";
export const COOKIE_LINE_SPACING = "accessibility_line_spacing";
export const COOKIE_REDUCED_MOTION = "accessibility_reduced_motion";

export const FONT_SIZE_LABELS: Record<FontSize, string> = {
  normal: "Default (100%)",
  large: "Large (115%)",
  "extra-large": "Extra Large (130%)",
};

export const FONT_SIZE_DESCRIPTIONS: Record<FontSize, string> = {
  normal: "Standard text size across all views and navigation.",
  large: "Increased font size for improved legibility.",
  "extra-large": "Maximum text scale for high readability.",
};

export const CONTRAST_LABELS: Record<ContrastMode, string> = {
  normal: "Standard contrast",
  high: "High contrast",
};

export const CONTRAST_DESCRIPTIONS: Record<ContrastMode, string> = {
  normal: "Standard 180Connect colour palette and opacity ramps.",
  high: "WCAG AAA 7:1+ contrast, solid borders, and enhanced focus indicators.",
};

export const LINE_SPACING_LABELS: Record<LineSpacing, string> = {
  normal: "Standard",
  relaxed: "Relaxed",
};

export const LINE_SPACING_DESCRIPTIONS: Record<LineSpacing, string> = {
  normal: "Standard line height and spacing.",
  relaxed: "Expanded line height and letter spacing for easier reading flow.",
};

export const REDUCED_MOTION_LABELS: Record<ReducedMotion, string> = {
  normal: "Standard motion",
  reduced: "Reduced motion",
};

export const REDUCED_MOTION_DESCRIPTIONS: Record<ReducedMotion, string> = {
  normal: "Smooth hover transitions and micro-animations.",
  reduced: "Disables non-essential animations, transitions, and hover lifts.",
};

export const fontSizeSchema = z.enum(FONT_SIZES).catch("normal");
export const contrastSchema = z.enum(CONTRAST_MODES).catch("normal");
export const lineSpacingSchema = z.enum(LINE_SPACINGS).catch("normal");
export const reducedMotionSchema = z.enum(REDUCED_MOTIONS).catch("normal");

export const accessibilitySettingsSchema = z.object({
  fontSize: fontSizeSchema,
  contrast: contrastSchema,
  lineSpacing: lineSpacingSchema,
  reducedMotion: reducedMotionSchema,
});

export type AccessibilitySettings = z.infer<typeof accessibilitySettingsSchema>;

export const DEFAULT_ACCESSIBILITY_SETTINGS: AccessibilitySettings = {
  fontSize: "normal",
  contrast: "normal",
  lineSpacing: "normal",
  reducedMotion: "normal",
};

export type ParsedAccessibilitySettings =
  | { ok: true; value: AccessibilitySettings }
  | { ok: false; message: string };

/**
 * Validates and normalizes accessibility settings inputs.
 * Invalid or unknown values safely fall back to platform defaults.
 */
export function parseAccessibilitySettings(input: {
  fontSize?: unknown;
  contrast?: unknown;
  lineSpacing?: unknown;
  reducedMotion?: unknown;
}): ParsedAccessibilitySettings {
  try {
    const rawFontSize =
      typeof input.fontSize === "string" && FONT_SIZES.includes(input.fontSize as FontSize)
        ? input.fontSize
        : "normal";

    const rawContrast =
      typeof input.contrast === "string" &&
      CONTRAST_MODES.includes(input.contrast as ContrastMode)
        ? input.contrast
        : "normal";

    const rawLineSpacing =
      typeof input.lineSpacing === "string" &&
      LINE_SPACINGS.includes(input.lineSpacing as LineSpacing)
        ? input.lineSpacing
        : "normal";

    const rawReducedMotion =
      typeof input.reducedMotion === "string" &&
      REDUCED_MOTIONS.includes(input.reducedMotion as ReducedMotion)
        ? input.reducedMotion
        : "normal";

    const result = accessibilitySettingsSchema.safeParse({
      fontSize: rawFontSize,
      contrast: rawContrast,
      lineSpacing: rawLineSpacing,
      reducedMotion: rawReducedMotion,
    });

    if (!result.success) {
      return {
        ok: false,
        message: result.error.issues[0]?.message ?? "Invalid accessibility settings.",
      };
    }

    return { ok: true, value: result.data };
  } catch {
    return {
      ok: false,
      message: "Could not parse accessibility settings.",
    };
  }
}
