// F089: Score by Sector — pure calculation logic.
//
// Real blocker, same as F088: the ticket's own "Blocked By" note says
// "Sector weight" is undecided, and its Dependency Notes say this needs
// F055 ("standardised sector data") — which doesn't exist yet.
// ORGANISATIONS has no sector field at all right now (confirmed against
// the real schema; also matches the note in
// src/app/settings/outreach-preferences/constants.ts: "ORGANISATIONS.sector
// has no enum yet (LLM-classified free text, F089/F041/F055 not built)").
//
// So this function takes a sector value as a plain input rather than
// reading it from a real organisation row — there's no real field to read
// yet. Once F055 defines the actual sector field/classification, whatever
// reads that value can call this function with it directly; nothing here
// needs to change.
//
// AC3: a client with no sector recorded must get an explicit default
// treatment, not an error or a silent zero — handled below, not left
// implicit.

export type SectorScoreResult = {
  score: number;
  usedDefault: boolean;
};

/**
 * TODO: placeholder ranking, not a real decision. The ticket's "Blocked By"
 * note flags the actual sector ranking/weight as unresolved. Every known
 * sector currently scores identically (0.5, a neutral midpoint) — this is
 * NOT "sector doesn't matter", it's "we don't yet know which sectors
 * should score higher than others". Replace with real per-sector values
 * once the team decides them.
 */
const PLACEHOLDER_SECTOR_SCORE = 0.5;

/**
 * AC3: explicit default for a missing sector, distinct from a real score
 * of 0. A charity with no sector recorded is not being penalised as if
 * "sector: worst possible" — it's being treated as "unknown", scored at
 * the same neutral midpoint as every known sector until real per-sector
 * rankings exist.
 */
const DEFAULT_FOR_MISSING_SECTOR = 0.5;

export function scoreBySector(sector: string | null | undefined): SectorScoreResult {
  const trimmed = sector?.trim();

  if (!trimmed) {
    return { score: DEFAULT_FOR_MISSING_SECTOR, usedDefault: true };
  }

  // TODO: every sector currently maps to the same placeholder score —
  // there is no real per-sector ranking yet (see comment above).
  return { score: PLACEHOLDER_SECTOR_SCORE, usedDefault: false };
}