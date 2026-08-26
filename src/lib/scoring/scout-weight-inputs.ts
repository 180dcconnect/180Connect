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

export const SCOUT_WEIGHT_PARAMETERS = [
  {
    key: "sector",
    label: "Sector fit",
    description:
      "How strongly a client's sector influences its priority. Sector scoring stands at a neutral placeholder until F089 lands.",
  },
  {
    key: "geography",
    label: "Geography",
    description: "Weight given to where the client is based, relative to priority regions.",
  },
  {
    key: "size",
    label: "Organisation size",
    description: "Weight given to the client's latest annual income band.",
  },
  {
    key: "partnershipHistory",
    label: "Partnership history",
    description: "Weight given to previously matched grant awards (360Giving data).",
  },
  {
    key: "previousContact",
    label: "Previous contact",
    description: "Weight given to where the client sits in the outreach pipeline today.",
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
  sector: percentField("Sector fit"),
  geography: percentField("Geography"),
  size: percentField("Organisation size"),
  partnershipHistory: percentField("Partnership history"),
  previousContact: percentField("Previous contact"),
});

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
