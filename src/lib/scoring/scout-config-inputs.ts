// The score settings screen's form: what an admin edits, how it is validated, and
// how it converts to and from the stored SCOUT config.
//
// The screen speaks percentages and a ranking; the database speaks 0-1 fractions
// and per-sector scores. This module owns that translation so neither the client
// component nor the Server Action improvises it. Pure, for `node --test`.

import { z } from "zod";

// Relative imports: runs under `node --test`, which does not read tsconfig aliases.
import { INCOME_BAND_OPTIONS, type IncomeBand } from "../income-band.ts";
import type { ScoutWeights } from "./calculate-priority-score.ts";
import {
  MAX_PRIORITY_TOWNS,
  MAX_TOWN_LENGTH,
  normaliseTownList,
  SECTOR_CATEGORIES,
  sectorRankingFrom,
  sectorScoresFromRanking,
  type ScoringRules,
} from "./scout-config.ts";
import {
  anyWeightCounts,
  toFractions,
  toPercentages,
  weightsEqual,
  type ScoutWeightKey,
} from "./scout-weight-inputs.ts";
import type { SectorCategory } from "./score-by-sector.ts";

export type ScoutConfigInput = {
  /** 0-100 per check. */
  weights: Record<ScoutWeightKey, number>;
  /** All six sector categories, most important first. */
  sectorOrder: SectorCategory[];
  priorityTowns: string[];
  /** 0-100. */
  geography: { inside: number; outside: number };
  /** 0-100 per income band. */
  sizeScores: Record<IncomeBand, number>;
};

/** What saving returns to the screen. */
export type SaveScoutConfigResult =
  | { status: "error"; message: string }
  | { status: "unchanged"; message: string }
  | { status: "saved"; total: number };

const percent = z.number().refine(Number.isFinite, "Each setting must be a number.").min(0).max(100);

const schema = z.object({
  weights: z.object({
    sector: percent,
    geography: percent,
    size: percent,
    partnershipHistory: percent,
    previousContact: percent,
  }),
  sectorOrder: z
    .array(z.string())
    .refine(
      (order) =>
        order.length === SECTOR_CATEGORIES.length &&
        new Set(order).size === order.length &&
        order.every((category) => (SECTOR_CATEGORIES as string[]).includes(category)),
      "The sector ranking must list each sector exactly once.",
    ),
  priorityTowns: z
    .array(z.string().max(MAX_TOWN_LENGTH, `A town name can be at most ${MAX_TOWN_LENGTH} characters.`))
    .max(MAX_PRIORITY_TOWNS, `At most ${MAX_PRIORITY_TOWNS} priority towns can be set.`),
  geography: z.object({ inside: percent, outside: percent }),
  sizeScores: z.object({
    under_10k: percent,
    "10k_100k": percent,
    "100k_1m": percent,
    over_1m: percent,
  }),
});

export function validateScoutConfigInput(
  raw: unknown,
): { success: true; data: ScoutConfigInput } | { success: false; message: string } {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return {
      success: false,
      message: parsed.error.issues[0]?.message ?? "Some of the settings are not valid.",
    };
  }
  if (!anyWeightCounts(parsed.data.weights)) {
    return {
      success: false,
      message: "At least one check has to count towards the score, or every client would score zero.",
    };
  }
  return {
    success: true,
    data: {
      ...parsed.data,
      sectorOrder: parsed.data.sectorOrder as SectorCategory[],
      priorityTowns: normaliseTownList(parsed.data.priorityTowns),
    },
  };
}

const toPercent = (fraction: number) => Math.round(fraction * 1000) / 10;
const toFraction = (percentage: number) => Math.round(percentage * 10) / 1000;

export function inputFromStored(weights: ScoutWeights, rules: ScoringRules): ScoutConfigInput {
  return {
    weights: toPercentages(weights),
    sectorOrder: sectorRankingFrom(rules.sectorScores),
    priorityTowns: [...rules.geography.priorityTowns],
    geography: {
      inside: toPercent(rules.geography.insideScore),
      outside: toPercent(rules.geography.outsideScore),
    },
    sizeScores: Object.fromEntries(
      INCOME_BAND_OPTIONS.map((band) => [band, toPercent(rules.sizeScores[band])]),
    ) as Record<IncomeBand, number>,
  };
}

/** The jsonb set_scout_config expects. */
export function rpcPayloadFromInput(input: ScoutConfigInput) {
  return {
    weights: toFractions(input.weights),
    sectorScores: sectorScoresFromRanking(input.sectorOrder),
    geography: {
      priorityTowns: normaliseTownList(input.priorityTowns),
      insideScore: toFraction(input.geography.inside),
      outsideScore: toFraction(input.geography.outside),
    },
    sizeScores: Object.fromEntries(
      INCOME_BAND_OPTIONS.map((band) => [band, toFraction(input.sizeScores[band])]),
    ) as Record<IncomeBand, number>,
  };
}

const close = (a: number, b: number) => Math.abs(a - b) < 0.05;

/** True when two form states describe the same setup (0.1% tolerance). */
export function configInputsEqual(a: ScoutConfigInput, b: ScoutConfigInput): boolean {
  const townKey = (towns: string[]) =>
    normaliseTownList(towns)
      .map((town) => town.toLowerCase())
      .join("|");
  return (
    weightsEqual(toFractions(a.weights), toFractions(b.weights)) &&
    a.sectorOrder.join("|") === b.sectorOrder.join("|") &&
    townKey(a.priorityTowns) === townKey(b.priorityTowns) &&
    close(a.geography.inside, b.geography.inside) &&
    close(a.geography.outside, b.geography.outside) &&
    INCOME_BAND_OPTIONS.every((band) => close(a.sizeScores[band], b.sizeScores[band]))
  );
}
