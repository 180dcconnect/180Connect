import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseAccessibilitySettings,
  readAccessibilityCookies,
  settingsFromAccountJson,
  accessibilityAttributes,
  sameAccessibilitySettings,
  isDefaultAccessibilitySettings,
  ACCESSIBILITY_FIELDS,
  DEFAULT_ACCESSIBILITY_SETTINGS,
  FONT_SIZES,
  FONT_SIZE_LABELS,
  FONT_SIZE_DESCRIPTIONS,
  CONTRAST_MODES,
  CONTRAST_LABELS,
  CONTRAST_DESCRIPTIONS,
  LINE_SPACINGS,
  LINE_SPACING_LABELS,
  LINE_SPACING_DESCRIPTIONS,
  REDUCED_MOTIONS,
  REDUCED_MOTION_LABELS,
  REDUCED_MOTION_DESCRIPTIONS,
  UNDERLINE_LINKS,
  UNDERLINE_LINKS_LABELS,
  UNDERLINE_LINKS_DESCRIPTIONS,
  FOCUS_INDICATORS,
  FOCUS_INDICATOR_LABELS,
  FOCUS_INDICATOR_DESCRIPTIONS,
  STATUS_COLOURS,
  STATUS_COLOURS_LABELS,
  STATUS_COLOURS_DESCRIPTIONS,
  COOKIE_FONT_SIZE,
  COOKIE_REDUCED_MOTION,
} from "./accessibility.ts";

test("returns default settings when given empty input", () => {
  const result = parseAccessibilitySettings({});
  assert.deepEqual(result, {
    ok: true,
    value: DEFAULT_ACCESSIBILITY_SETTINGS,
  });
});

test("every field's first value is its default", () => {
  for (const field of ACCESSIBILITY_FIELDS) {
    assert.equal(DEFAULT_ACCESSIBILITY_SETTINGS[field.key], field.values[0]);
  }
});

test("accepts every allowed value of every field, leaving the others default", () => {
  for (const field of ACCESSIBILITY_FIELDS) {
    for (const value of field.values) {
      const result = parseAccessibilitySettings({ [field.key]: value });
      assert.equal(result.ok, true);
      if (result.ok) {
        assert.deepEqual(result.value, { ...DEFAULT_ACCESSIBILITY_SETTINGS, [field.key]: value });
      }
    }
  }
});

test("accepts a full custom configuration", () => {
  const custom = {
    fontSize: "extra-large",
    contrast: "high",
    lineSpacing: "relaxed",
    reducedMotion: "off",
    underlineLinks: "on",
    focusIndicator: "strong",
    statusColours: "colour-blind",
  };
  const result = parseAccessibilitySettings(custom);
  assert.deepEqual(result, {
    ok: true,
    value: custom,
  });
});

test("safely falls back to defaults for invalid or unknown values", () => {
  const invalid = {
    fontSize: "huge",
    contrast: "ultra-high",
    lineSpacing: "triple",
    reducedMotion: "none",
    underlineLinks: "sometimes",
    focusIndicator: "neon",
    statusColours: "rainbow",
  };
  const result = parseAccessibilitySettings(invalid);
  assert.deepEqual(result, {
    ok: true,
    value: DEFAULT_ACCESSIBILITY_SETTINGS,
  });
});

test("safely handles non-string or nullish properties", () => {
  const malformed = {
    fontSize: 123,
    contrast: null,
    lineSpacing: undefined,
    reducedMotion: false,
    underlineLinks: {},
  };
  const result = parseAccessibilitySettings(malformed);
  assert.deepEqual(result, {
    ok: true,
    value: DEFAULT_ACCESSIBILITY_SETTINGS,
  });
});

test("reads settings from a cookie-shaped getter", () => {
  const jar: Record<string, string> = {
    [COOKIE_FONT_SIZE]: "large",
    [COOKIE_REDUCED_MOTION]: "bogus",
  };
  const settings = readAccessibilityCookies((name) => jar[name]);
  assert.deepEqual(settings, { ...DEFAULT_ACCESSIBILITY_SETTINGS, fontSize: "large" });
});

test("account JSON: null for anything that is not an object, parsed otherwise", () => {
  assert.equal(settingsFromAccountJson(null), null);
  assert.equal(settingsFromAccountJson("large"), null);
  assert.equal(settingsFromAccountJson([]), null);
  assert.deepEqual(settingsFromAccountJson({ contrast: "high", extra: 1 }), {
    ...DEFAULT_ACCESSIBILITY_SETTINGS,
    contrast: "high",
  });
});

test("html attributes are omitted for defaults and set otherwise", () => {
  const attributes = accessibilityAttributes({
    ...DEFAULT_ACCESSIBILITY_SETTINGS,
    statusColours: "colour-blind",
  });
  assert.equal(attributes["data-status-colours"], "colour-blind");
  assert.equal(attributes["data-font-size"], undefined);
});

test("equality and default checks", () => {
  assert.equal(isDefaultAccessibilitySettings(DEFAULT_ACCESSIBILITY_SETTINGS), true);
  const changed = { ...DEFAULT_ACCESSIBILITY_SETTINGS, focusIndicator: "strong" as const };
  assert.equal(isDefaultAccessibilitySettings(changed), false);
  assert.equal(sameAccessibilitySettings(changed, { ...changed }), true);
});

test("provides readable labels and descriptions for all options (F205)", () => {
  const pairs: Array<[readonly string[], Record<string, string>, Record<string, string>]> = [
    [FONT_SIZES, FONT_SIZE_LABELS, FONT_SIZE_DESCRIPTIONS],
    [CONTRAST_MODES, CONTRAST_LABELS, CONTRAST_DESCRIPTIONS],
    [LINE_SPACINGS, LINE_SPACING_LABELS, LINE_SPACING_DESCRIPTIONS],
    [REDUCED_MOTIONS, REDUCED_MOTION_LABELS, REDUCED_MOTION_DESCRIPTIONS],
    [UNDERLINE_LINKS, UNDERLINE_LINKS_LABELS, UNDERLINE_LINKS_DESCRIPTIONS],
    [FOCUS_INDICATORS, FOCUS_INDICATOR_LABELS, FOCUS_INDICATOR_DESCRIPTIONS],
    [STATUS_COLOURS, STATUS_COLOURS_LABELS, STATUS_COLOURS_DESCRIPTIONS],
  ];
  for (const [values, labels, descriptions] of pairs) {
    for (const value of values) {
      assert.ok(labels[value]?.length > 0);
      assert.ok(descriptions[value]?.length > 0);
    }
  }
});
