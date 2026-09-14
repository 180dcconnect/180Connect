import { z } from "zod";

/**
 * Accessibility Settings (F205).
 *
 * Allows users to adjust text readability, typography scale, contrast,
 * line spacing, motion, link styling, focus visibility and status colours
 * across the entire platform.
 *
 * Every setting is described once, in `ACCESSIBILITY_FIELDS` — its cookie, the
 * attribute it sets on `<html>`, and its allowed values (the first is the
 * default). The root layout, the provider, the settings page and the save
 * action all loop over that list, so adding a setting is one entry here plus
 * its CSS rather than an edit in five places that can disagree.
 */

export const FONT_SIZES = ["normal", "large", "extra-large"] as const;
export type FontSize = (typeof FONT_SIZES)[number];

export const CONTRAST_MODES = ["normal", "high"] as const;
export type ContrastMode = (typeof CONTRAST_MODES)[number];

export const LINE_SPACINGS = ["normal", "relaxed"] as const;
export type LineSpacing = (typeof LINE_SPACINGS)[number];

export const REDUCED_MOTIONS = ["normal", "reduced", "off"] as const;
export type ReducedMotion = (typeof REDUCED_MOTIONS)[number];

export const UNDERLINE_LINKS = ["off", "on"] as const;
export type UnderlineLinks = (typeof UNDERLINE_LINKS)[number];

export const FOCUS_INDICATORS = ["standard", "strong"] as const;
export type FocusIndicator = (typeof FOCUS_INDICATORS)[number];

export const STATUS_COLOURS = ["standard", "colour-blind"] as const;
export type StatusColours = (typeof STATUS_COLOURS)[number];

export const COOKIE_FONT_SIZE = "accessibility_font_size";
export const COOKIE_CONTRAST = "accessibility_contrast";
export const COOKIE_LINE_SPACING = "accessibility_line_spacing";
export const COOKIE_REDUCED_MOTION = "accessibility_reduced_motion";
export const COOKIE_UNDERLINE_LINKS = "accessibility_underline_links";
export const COOKIE_FOCUS_INDICATOR = "accessibility_focus_indicator";
export const COOKIE_STATUS_COLOURS = "accessibility_status_colours";

export const FONT_SIZE_LABELS: Record<FontSize, string> = {
  normal: "Default (100%)",
  large: "Large (115%)",
  "extra-large": "Extra large (130%)",
};

export const FONT_SIZE_DESCRIPTIONS: Record<FontSize, string> = {
  normal: "Standard size across all views and navigation.",
  large: "Text, spacing and controls 15% larger, together.",
  "extra-large": "Text, spacing and controls 30% larger, for the most comfortable reading.",
};

export const CONTRAST_LABELS: Record<ContrastMode, string> = {
  normal: "Standard contrast",
  high: "High contrast",
};

export const CONTRAST_DESCRIPTIONS: Record<ContrastMode, string> = {
  normal: "Standard 180Connect colour palette.",
  high: "Near-black text, darker borders and stronger focus outlines.",
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
  off: "No motion",
};

export const REDUCED_MOTION_DESCRIPTIONS: Record<ReducedMotion, string> = {
  normal: "Entrances, transitions and hover movement.",
  reduced: "No sliding or scaling. Loading spinners keep turning so you can tell work is happening.",
  off: "Everything stops — animations, fades, transitions and spinners.",
};

export const UNDERLINE_LINKS_LABELS: Record<UnderlineLinks, string> = {
  off: "Colour only",
  on: "Underlined",
};

export const UNDERLINE_LINKS_DESCRIPTIONS: Record<UnderlineLinks, string> = {
  off: "Links are shown in blue text.",
  on: "Every link in page content is underlined, so it never relies on colour alone.",
};

export const FOCUS_INDICATOR_LABELS: Record<FocusIndicator, string> = {
  standard: "Standard",
  strong: "Strong",
};

export const FOCUS_INDICATOR_DESCRIPTIONS: Record<FocusIndicator, string> = {
  standard: "Each control's own focus ring when you move to it with the keyboard.",
  strong: "A thick outline on whatever has keyboard focus — every control, always.",
};

export const STATUS_COLOURS_LABELS: Record<StatusColours, string> = {
  standard: "Standard",
  "colour-blind": "Colour-blind safe",
};

export const STATUS_COLOURS_DESCRIPTIONS: Record<StatusColours, string> = {
  standard: "Green for good, amber for waiting, red for a problem.",
  "colour-blind":
    "Blue for good, amber for waiting, vermilion for a problem — distinguishable with red–green colour deficiency.",
};

export const fontSizeSchema = z.enum(FONT_SIZES).catch("normal");
export const contrastSchema = z.enum(CONTRAST_MODES).catch("normal");
export const lineSpacingSchema = z.enum(LINE_SPACINGS).catch("normal");
export const reducedMotionSchema = z.enum(REDUCED_MOTIONS).catch("normal");
export const underlineLinksSchema = z.enum(UNDERLINE_LINKS).catch("off");
export const focusIndicatorSchema = z.enum(FOCUS_INDICATORS).catch("standard");
export const statusColoursSchema = z.enum(STATUS_COLOURS).catch("standard");

export const accessibilitySettingsSchema = z.object({
  fontSize: fontSizeSchema,
  contrast: contrastSchema,
  lineSpacing: lineSpacingSchema,
  reducedMotion: reducedMotionSchema,
  underlineLinks: underlineLinksSchema,
  focusIndicator: focusIndicatorSchema,
  statusColours: statusColoursSchema,
});

export type AccessibilitySettings = z.infer<typeof accessibilitySettingsSchema>;

export type AccessibilityField = {
  key: keyof AccessibilitySettings;
  cookie: string;
  /** Set on `<html>` when the value is not the default; globals.css reads it. */
  attribute: string;
  /** Allowed values. The first is the default. */
  values: readonly string[];
};

export const ACCESSIBILITY_FIELDS: readonly AccessibilityField[] = [
  { key: "fontSize", cookie: COOKIE_FONT_SIZE, attribute: "data-font-size", values: FONT_SIZES },
  { key: "contrast", cookie: COOKIE_CONTRAST, attribute: "data-contrast", values: CONTRAST_MODES },
  {
    key: "lineSpacing",
    cookie: COOKIE_LINE_SPACING,
    attribute: "data-line-spacing",
    values: LINE_SPACINGS,
  },
  {
    key: "reducedMotion",
    cookie: COOKIE_REDUCED_MOTION,
    attribute: "data-reduced-motion",
    values: REDUCED_MOTIONS,
  },
  {
    key: "underlineLinks",
    cookie: COOKIE_UNDERLINE_LINKS,
    attribute: "data-underline-links",
    values: UNDERLINE_LINKS,
  },
  {
    key: "focusIndicator",
    cookie: COOKIE_FOCUS_INDICATOR,
    attribute: "data-focus-indicator",
    values: FOCUS_INDICATORS,
  },
  {
    key: "statusColours",
    cookie: COOKIE_STATUS_COLOURS,
    attribute: "data-status-colours",
    values: STATUS_COLOURS,
  },
];

export const DEFAULT_ACCESSIBILITY_SETTINGS: AccessibilitySettings = {
  fontSize: "normal",
  contrast: "normal",
  lineSpacing: "normal",
  reducedMotion: "normal",
  underlineLinks: "off",
  focusIndicator: "standard",
  statusColours: "standard",
};

export type AccessibilityInput = Partial<Record<keyof AccessibilitySettings, unknown>>;

export type ParsedAccessibilitySettings =
  | { ok: true; value: AccessibilitySettings }
  | { ok: false; message: string };

/**
 * Validates and normalizes accessibility settings inputs.
 * Invalid or unknown values safely fall back to platform defaults.
 */
export function parseAccessibilitySettings(
  input: AccessibilityInput,
): ParsedAccessibilitySettings {
  const raw: Record<string, string> = {};
  for (const field of ACCESSIBILITY_FIELDS) {
    const value = input[field.key];
    raw[field.key] =
      typeof value === "string" && field.values.includes(value) ? value : field.values[0];
  }

  const result = accessibilitySettingsSchema.safeParse(raw);
  if (!result.success) {
    return {
      ok: false,
      message: result.error.issues[0]?.message ?? "Invalid accessibility settings.",
    };
  }
  return { ok: true, value: result.data };
}

/** Settings from a cookie jar (or anything shaped like one, e.g. localStorage). */
export function readAccessibilityCookies(
  get: (name: string) => string | null | undefined,
): AccessibilitySettings {
  const input: AccessibilityInput = {};
  for (const field of ACCESSIBILITY_FIELDS) {
    input[field.key] = get(field.cookie) ?? undefined;
  }
  const parsed = parseAccessibilitySettings(input);
  return parsed.ok ? parsed.value : DEFAULT_ACCESSIBILITY_SETTINGS;
}

/**
 * Settings from `users.accessibility_settings`. Null means the account has
 * never saved any — distinct from "saved the defaults", because a null account
 * adopts whatever this browser already has rather than overwriting it.
 */
export function settingsFromAccountJson(json: unknown): AccessibilitySettings | null {
  if (!json || typeof json !== "object" || Array.isArray(json)) return null;
  const parsed = parseAccessibilitySettings(json as AccessibilityInput);
  return parsed.ok ? parsed.value : null;
}

/** The `<html>` attributes for a set of settings; defaults are left off. */
export function accessibilityAttributes(
  settings: AccessibilitySettings,
): Record<string, string | undefined> {
  const attributes: Record<string, string | undefined> = {};
  for (const field of ACCESSIBILITY_FIELDS) {
    const value = settings[field.key];
    attributes[field.attribute] = value === field.values[0] ? undefined : value;
  }
  return attributes;
}

export function sameAccessibilitySettings(
  a: AccessibilitySettings,
  b: AccessibilitySettings,
): boolean {
  return ACCESSIBILITY_FIELDS.every((field) => a[field.key] === b[field.key]);
}

export function isDefaultAccessibilitySettings(settings: AccessibilitySettings): boolean {
  return sameAccessibilitySettings(settings, DEFAULT_ACCESSIBILITY_SETTINGS);
}
