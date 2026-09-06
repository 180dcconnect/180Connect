import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  getMouthPath,
  RATING_COLORS,
  RATING_LEVELS,
  RATING_UNSET_COLOR,
  MOUTH_CONTROL_Y,
  MOUTH_CORNER_Y,
  EYE_SCALE_Y,
} from "./feedback-face.ts";

describe("feedback-face data and curves", () => {
  it("defines five distinct levels and matching colors", () => {
    assert.equal(RATING_LEVELS.length, 5);
    assert.equal(RATING_COLORS.length, 5);
    const uniqueColors = new Set(RATING_COLORS);
    assert.equal(uniqueColors.size, 5);
  });

  it("defines five mouth control Y, corner Y, and eye scale points", () => {
    assert.equal(MOUTH_CONTROL_Y.length, 5);
    assert.equal(MOUTH_CORNER_Y.length, 5);
    assert.equal(EYE_SCALE_Y.length, 5);
  });

  it("generates correct SVG mouth path curve for each mood level", () => {
    // Level 1: frown (deep upward control point)
    const mouth1 = getMouthPath(1);
    assert.equal(mouth1, "M 22 49.5 Q 36 34 50 49.5");

    // Level 3: flat
    const mouth3 = getMouthPath(3);
    assert.equal(mouth3, "M 22 47 Q 36 47 50 47");

    // Level 5: smile (deep downward control point)
    const mouth5 = getMouthPath(5);
    assert.equal(mouth5, "M 22 44.5 Q 36 61 50 44.5");
  });

  it("clamps levels below 1 to neutral/valid range", () => {
    const mouth0 = getMouthPath(0);
    assert.ok(mouth0.startsWith("M 22"));
  });

  it("clamps levels above 5 to level 5", () => {
    const mouth6 = getMouthPath(6);
    assert.equal(mouth6, getMouthPath(5));
  });

  it("uses defined neutral unset color for unrated states", () => {
    assert.equal(RATING_UNSET_COLOR, "#a3a3a3");
  });
});
