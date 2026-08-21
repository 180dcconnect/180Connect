import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseAccessibilitySettings,
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
} from "./accessibility.ts";

test("returns default settings when given empty input", () => {
  const result = parseAccessibilitySettings({});
  assert.deepEqual(result, {
    ok: true,
    value: DEFAULT_ACCESSIBILITY_SETTINGS,
  });
});

test("accepts valid font size options", () => {
  for (const fontSize of FONT_SIZES) {
    const result = parseAccessibilitySettings({ fontSize });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.value.fontSize, fontSize);
      assert.equal(result.value.contrast, "normal");
      assert.equal(result.value.lineSpacing, "normal");
      assert.equal(result.value.reducedMotion, "normal");
    }
  }
});

test("accepts valid contrast modes", () => {
  for (const contrast of CONTRAST_MODES) {
    const result = parseAccessibilitySettings({ contrast });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.value.contrast, contrast);
    }
  }
});

test("accepts valid line spacing options", () => {
  for (const lineSpacing of LINE_SPACINGS) {
    const result = parseAccessibilitySettings({ lineSpacing });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.value.lineSpacing, lineSpacing);
    }
  }
});

test("accepts valid reduced motion options", () => {
  for (const reducedMotion of REDUCED_MOTIONS) {
    const result = parseAccessibilitySettings({ reducedMotion });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.value.reducedMotion, reducedMotion);
    }
  }
});

test("accepts a full custom configuration", () => {
  const custom = {
    fontSize: "extra-large",
    contrast: "high",
    lineSpacing: "relaxed",
    reducedMotion: "reduced",
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
  };
  const result = parseAccessibilitySettings(malformed);
  assert.deepEqual(result, {
    ok: true,
    value: DEFAULT_ACCESSIBILITY_SETTINGS,
  });
});

test("provides readable labels and descriptions for all options (F205)", () => {
  for (const fontSize of FONT_SIZES) {
    assert.ok(fontSize in FONT_SIZE_LABELS);
    assert.ok(fontSize in FONT_SIZE_DESCRIPTIONS);
    assert.ok(FONT_SIZE_LABELS[fontSize].length > 0);
  }
  for (const contrast of CONTRAST_MODES) {
    assert.ok(contrast in CONTRAST_LABELS);
    assert.ok(contrast in CONTRAST_DESCRIPTIONS);
    assert.ok(CONTRAST_LABELS[contrast].length > 0);
  }
  for (const lineSpacing of LINE_SPACINGS) {
    assert.ok(lineSpacing in LINE_SPACING_LABELS);
    assert.ok(lineSpacing in LINE_SPACING_DESCRIPTIONS);
    assert.ok(LINE_SPACING_LABELS[lineSpacing].length > 0);
  }
  for (const reducedMotion of REDUCED_MOTIONS) {
    assert.ok(reducedMotion in REDUCED_MOTION_LABELS);
    assert.ok(reducedMotion in REDUCED_MOTION_DESCRIPTIONS);
    assert.ok(REDUCED_MOTION_LABELS[reducedMotion].length > 0);
  }
});

