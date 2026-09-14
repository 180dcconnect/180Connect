// F096: shared shape + validation for the admin score settings screen.
//
// Kept out of the "use server" module (which may only export async functions)
// and out of the client component, so both sides import this one definition of
// what a weights submission is. Validation goes through src/lib/validation.ts's
// safeValidate like every other form in the app.
//
// The form speaks percentages (0-100, friendlier for relative weights); the
// database and rule engine speak fractions (0-1). This module owns that
// conversion so neither side improvises it.

import { z } from "zod";
// Relative, not "@/lib/...": the Node test runner resolves this module directly
// and does not read Next's tsconfig path aliases.
import { safeValidate } from "../validation.ts";

// Labels are the names the client record's score breakdown uses
// (src/app/clients/[id]/score-breakdown.tsx), so an admin tuning "Size" here is
// tuning the "Size" they see on a client. Descriptions are written for an admin
// who is not a developer (AGENTS.md, "Who will maintain this app").
export const SCOUT_WEIGHT_PARAMETERS = [
  {
    key: "sector",
    label: "Sector",
    description: "The kind of work the client does, scored by the sector ranking below.",
  },
  {
    key: "geography",
    label: "Geography",
    description: "Whether the client is based in one of the priority towns set below.",
  },
  {
    key: "size",
    label: "Size",
    description:
      "The client's income on its latest published accounts, scored by the income bands below.",
  },
  {
    key: "partnershipHistory",
    label: "Partnership history",
    description:
      "How many public grants we can match to the client. More grants rank higher; none never counts against them.",
  },
  {
    key: "previousContact",
    label: "Previous contact",
    description:
      "How far the client got with us before — already worked with us ranks highest, a firm no ranks lowest.",
  },
] as const;

export type ScoutWeightKey = (typeof SCOUT_WEIGHT_PARAMETERS)[number]["key"];

export type ScoutWeightsInput = Record<ScoutWeightKey, number>;

const percentField = (label: string) =>
  z.preprocess(
    (value) => {
      if (typeof value !== "string") return value;
      const trimmed = value.trim();
      // An empty field is a validation error, not a silent zero — an admin
      // clearing a box should be told, not have the parameter quietly muted.
      return trimmed === "" ? NaN : Number(trimmed);
    },
    z
      .number()
      .refine(Number.isFinite, { message: `${label} must be a number.` })
      .min(0, { message: `${label} cannot be below 0%.` })
      .max(100, { message: `${label} cannot be above 100%.` }),
  );

// Keys must mirror SCOUT_WEIGHT_PARAMETERS; scout-weight-inputs.test.ts asserts
// they stay in sync so a new parameter cannot be added to one side only.
export const scoutWeightsFormSchema = z.object({
  sector: percentField("Sector"),
  geography: percentField("Geography"),
  size: percentField("Size"),
  partnershipHistory: percentField("Partnership history"),
  previousContact: percentField("Previous contact"),
});

/**
 * False when every weight is zero. The engine scores every client 0 in that case
 * (calculatePriorityScore's zero-sum guard), which empties the priority order
 * without saying so. Kept as its own check rather than a refine on the schema, so
 * the schema stays a plain object whose keys the tests compare.
 */
export function anyWeightCounts(weights: Record<ScoutWeightKey, number>): boolean {
  return SCOUT_WEIGHT_PARAMETERS.some((parameter) => (weights[parameter.key] ?? 0) > 0);
}

/** Each weight's share of the whole score, 0-100. All zero when nothing counts. */
export function weightShares(weights: Record<ScoutWeightKey, number>): Record<ScoutWeightKey, number> {
  const total = SCOUT_WEIGHT_PARAMETERS.reduce(
    (sum, parameter) => sum + Math.max(0, weights[parameter.key] ?? 0),
    0,
  );
  return Object.fromEntries(
    SCOUT_WEIGHT_PARAMETERS.map((parameter) => [
      parameter.key,
      total === 0 ? 0 : (Math.max(0, weights[parameter.key] ?? 0) / total) * 100,
    ]),
  ) as Record<ScoutWeightKey, number>;
}

/** Form field name for a parameter ("weight_sector" etc.). */
export function weightFieldName(key: ScoutWeightKey): string {
  return `weight_${key}`;
}

/** Reads the five form fields into raw (unvalidated) values for safeValidate. */
export function readWeightsForm(formData: FormData): Record<ScoutWeightKey, unknown> {
  const raw: Record<string, unknown> = {};
  for (const parameter of SCOUT_WEIGHT_PARAMETERS) {
    raw[parameter.key] = formData.get(weightFieldName(parameter.key));
  }
  return raw;
}

/** Percentages -> the 0-1 fractions the engine and RPC expect. */
export function toFractions(percentages: Record<ScoutWeightKey, number>): Record<ScoutWeightKey, number> {
  return Object.fromEntries(
    Object.entries(percentages).map(([key, value]) => [key, value / 100]),
  ) as Record<ScoutWeightKey, number>;
}

/** 0-1 fractions -> whole percentages for display, rounded to at most 1dp. */
export function toPercentages(fractions: Record<string, unknown>): Record<ScoutWeightKey, number> {
  return Object.fromEntries(
    SCOUT_WEIGHT_PARAMETERS.map((parameter) => {
      const value = Number(fractions[parameter.key]);
      const fraction = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
      return [parameter.key, Math.round(fraction * 1000) / 10];
    }),
  ) as Record<ScoutWeightKey, number>;
}

/**
 * True when two fraction-weight objects describe the same tuning. Compared at
 * one decimal of a percent — sub-0.1% drift from float rounding is not a change
 * worth rescoring every client over.
 */
export function weightsEqual(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  return SCOUT_WEIGHT_PARAMETERS.every((parameter) => {
    const left = Number(a[parameter.key]);
    const right = Number(b[parameter.key]);
    if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
    return Math.abs(left - right) < 0.001;
  });
}

/**
 * Validates one submission. Returns per-field errors so every bad slider is
 * flagged at once rather than one submit at a time.
 */
export function validateWeightsForm(raw: unknown) {
  return safeValidate(scoutWeightsFormSchema, raw);
}
