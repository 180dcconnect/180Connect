// The SCOUT scoring rules beyond the weights — what each check rewards.
//
// F096 made the weights (how much each check counts) an admin setting. The rules
// behind three of the checks were still constants: the sector ranking, the
// branch's priority towns with the score for being in or out of one, and the
// score per income band. They now live in MODEL_VERSIONS.config beside the
// weights (migration 20261004170000, set_scout_config), so an admin can change
// them without a developer.
//
// The code constants are not gone: they are the defaults, used for any section a
// stored config does not carry (every version saved before this change) and
// whenever the config cannot be read. Pure module — no I/O — so the scorers, the
// settings screen and `node --test` share one definition.

// Relative imports: runs under `node --test`, which does not read tsconfig aliases.
import { CLIENT_CRITERIA } from "../client-criteria-config.ts";
import { INCOME_BAND_OPTIONS, type IncomeBand } from "../income-band.ts";
import { normalisePlaceName } from "../place-name.ts";
import { DEFAULT_GEOGRAPHY_SCORES } from "./score-by-geography.ts";
import { DEFAULT_SIZE_BAND_SCORES } from "./score-by-organisation-size.ts";
import { DEFAULT_SECTOR_CATEGORY_SCORES, type SectorCategory } from "./score-by-sector.ts";

/** Sector categories in their default ranking order (highest first). */
export const SECTOR_CATEGORIES = (Object.keys(DEFAULT_SECTOR_CATEGORY_SCORES) as SectorCategory[]).sort(
  (a, b) => DEFAULT_SECTOR_CATEGORY_SCORES[b] - DEFAULT_SECTOR_CATEGORY_SCORES[a],
);

/**
 * Scores handed out by rank, highest first. The admin orders the six sectors; the
 * scores come from this ladder. It keeps the two properties score-by-sector.ts
 * requires of any ranking: every category distinct, and none equal to the 0.5
 * neutral a client with no sector gets.
 */
export const SECTOR_RANK_LADDER: readonly number[] = [0.7, 0.65, 0.6, 0.55, 0.45, 0.4];

export const MAX_PRIORITY_TOWNS = 30;
export const MAX_TOWN_LENGTH = 60;

export type GeographyRules = {
  /** Towns or local authorities the branch prioritises, as an admin typed them. */
  priorityTowns: string[];
  /** Geography score for a client in one of the towns, 0-1. */
  insideScore: number;
  /** Geography score for a client elsewhere, 0-1. */
  outsideScore: number;
};

export type ScoringRules = {
  sectorScores: Record<SectorCategory, number>;
  geography: GeographyRules;
  sizeScores: Record<IncomeBand, number>;
};

function titleCase(value: string): string {
  return value.replace(/\b\p{L}/gu, (letter) => letter.toUpperCase());
}

export const DEFAULT_SCORING_RULES: ScoringRules = {
  sectorScores: { ...DEFAULT_SECTOR_CATEGORY_SCORES },
  geography: {
    priorityTowns: CLIENT_CRITERIA.priorityCities.map(titleCase),
    insideScore: DEFAULT_GEOGRAPHY_SCORES.inside,
    outsideScore: DEFAULT_GEOGRAPHY_SCORES.outside,
  },
  sizeScores: { ...DEFAULT_SIZE_BAND_SCORES },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unit(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(1, value))
    : fallback;
}

/**
 * Trims, collapses inner whitespace, drops blanks and case-insensitive
 * duplicates, caps length and count. Order is kept, so the list reads the way it
 * was entered.
 */
export function normaliseTownList(towns: readonly unknown[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of towns) {
    if (typeof raw !== "string") continue;
    const town = raw.replace(/\s+/g, " ").trim().slice(0, MAX_TOWN_LENGTH);
    const key = town.toLowerCase();
    if (!town || seen.has(key)) continue;
    seen.add(key);
    result.push(town);
    if (result.length >= MAX_PRIORITY_TOWNS) break;
  }
  return result;
}

/**
 * Reads the rules out of a stored SCOUT config. Per-value fallback: a config
 * from before this change (weights only) yields exactly the defaults, and one bad
 * value degrades alone instead of discarding the whole config.
 */
export function sanitizeScoringRules(config: unknown): ScoringRules {
  const source = isRecord(config) ? config : {};
  const sector = isRecord(source.sectorScores) ? source.sectorScores : {};
  const size = isRecord(source.sizeScores) ? source.sizeScores : {};
  const geography = isRecord(source.geography) ? source.geography : {};

  return {
    sectorScores: Object.fromEntries(
      SECTOR_CATEGORIES.map((category) => [
        category,
        unit(sector[category], DEFAULT_SECTOR_CATEGORY_SCORES[category]),
      ]),
    ) as Record<SectorCategory, number>,
    geography: {
      priorityTowns: Array.isArray(geography.priorityTowns)
        ? normaliseTownList(geography.priorityTowns)
        : [...DEFAULT_SCORING_RULES.geography.priorityTowns],
      insideScore: unit(geography.insideScore, DEFAULT_GEOGRAPHY_SCORES.inside),
      outsideScore: unit(geography.outsideScore, DEFAULT_GEOGRAPHY_SCORES.outside),
    },
    sizeScores: Object.fromEntries(
      INCOME_BAND_OPTIONS.map((band) => [band, unit(size[band], DEFAULT_SIZE_BAND_SCORES[band])]),
    ) as Record<IncomeBand, number>,
  };
}

/** Sector scores for an admin's ranking (most important first), from the ladder. */
export function sectorScoresFromRanking(
  order: readonly SectorCategory[],
): Record<SectorCategory, number> {
  const ranked = [
    ...order.filter((category) => SECTOR_CATEGORIES.includes(category)),
    ...SECTOR_CATEGORIES.filter((category) => !order.includes(category)),
  ];
  return Object.fromEntries(
    ranked.map((category, index) => [category, SECTOR_RANK_LADDER[index] ?? SECTOR_RANK_LADDER.at(-1)!]),
  ) as Record<SectorCategory, number>;
}

/** The ranking a set of sector scores implies, highest first; ties keep default order. */
export function sectorRankingFrom(scores: Record<SectorCategory, number>): SectorCategory[] {
  return [...SECTOR_CATEGORIES].sort(
    (a, b) =>
      (scores[b] ?? 0) - (scores[a] ?? 0) ||
      SECTOR_CATEGORIES.indexOf(a) - SECTOR_CATEGORIES.indexOf(b),
  );
}

/** The town list in the lowercase normalised form the client criteria check compares against. */
export function townsForCriteria(rules: ScoringRules): string[] {
  const set = new Set<string>();
  for (const town of rules.geography.priorityTowns) {
    set.add(town.toLowerCase());
    set.add(normalisePlaceName(town));
  }
  return Array.from(set);
}
