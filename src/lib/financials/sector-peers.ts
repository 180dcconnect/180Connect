// Where one client's income sits among the clients we hold in the same sector.
//
// The quantiles themselves are computed in Postgres by
// `get_sector_income_distribution` (migration 20260922113000): picking one
// income per peer is a max-per-group, PostgREST cannot express DISTINCT ON, and
// doing it in the app meant shipping ~1,750 rows across the wire on every visit
// to the tab to produce six numbers. What stays here is the part that is a
// product decision rather than arithmetic — whether the comparison is worth
// showing at all — plus the scale the strip is drawn on.
//
// WHAT THIS IS NOT. It is not a comparison against the sector — it is a
// comparison against *our book*. The register holds ~170,000 charities and we
// hold a few hundred per sector, chosen by import criteria, so the peer set is
// a sample nobody drew at random. Every label this feeds says "clients on
// record" rather than "charities in this sector", and the count travels with
// the percentile so the reader can judge it themselves.
//
// SMALL n. A percentile over eight peers is noise wearing a number's clothes:
// one more import moves it by 12 points. Below MIN_PEERS_FOR_PERCENTILE the
// result carries the peers it found and refuses the percentile, and the strip
// says so instead of drawing a confident-looking mark. On the staging register
// the three large sectors clear it comfortably (Education & Training 363,
// Health & Social Care 247, Disability Support 124) and the two small ones do
// not always (Poverty Relief 36, Community Development 20) — which is exactly
// the case this guard exists for.

/**
 * Below this many peers, a percentile is not worth printing. Twelve is the
 * point where a single row moves the answer by less than ~8 points; the number
 * is a judgement, not a derivation, and it is here rather than inline so it can
 * be argued with in one place.
 */
export const MIN_PEERS_FOR_PERCENTILE = 12;

/**
 * One row of `get_sector_income_distribution`.
 *
 * Every money column is `numeric` in Postgres, and a `numeric` crosses the wire
 * as a string under some drivers and as a number under others — PostgREST
 * serialises it as a JSON number, node-postgres hands back a string. The shape
 * admits both rather than betting on one, and `toNumber` below is what settles
 * it. Getting this wrong is silent: string arithmetic would make every
 * comparison in the strip a lexicographic one, and "£9,000" would sort above
 * "£10,000,000" without erroring anywhere.
 */
export type SectorDistributionRow = {
  peer_count: number | string | null;
  min_income: number | string | null;
  p25_income: number | string | null;
  median_income: number | string | null;
  p75_income: number | string | null;
  max_income: number | string | null;
  smaller_count: number | string | null;
};

export type SectorPeerStats = {
  /** How many same-sector clients on record carry an income figure. */
  peerCount: number;
  /**
   * Share of peers this client is larger than, 0-1. Null when there are too
   * few peers to say — see MIN_PEERS_FOR_PERCENTILE.
   */
  percentile: number | null;
  /** The peer set's shape, for the strip. Null when there are no peers. */
  quartiles: { min: number; p25: number; median: number; p75: number; max: number } | null;
};

/** A finite number, or null. Absorbs the numeric-as-string case above. */
function toNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Turns one distribution row into what the strip draws.
 *
 * `hasOwnFigure` gates the percentile as well as the peer count: the RPC counts
 * peers below whatever figure it was handed, and a client with no filed income
 * hands it null — which would otherwise come back as a truthful-looking zero
 * and render as "larger than 0% of peers" for a client we simply have no
 * figure for.
 */
export function sectorPeerStatsFromDistribution(
  row: SectorDistributionRow | null | undefined,
  ownIncome: number | null | undefined,
): SectorPeerStats {
  const peerCount = toNumber(row?.peer_count) ?? 0;
  if (!row || peerCount <= 0) {
    return { peerCount: 0, percentile: null, quartiles: null };
  }

  const min = toNumber(row.min_income);
  const p25 = toNumber(row.p25_income);
  const median = toNumber(row.median_income);
  const p75 = toNumber(row.p75_income);
  const max = toNumber(row.max_income);

  // Any missing bound makes the strip undrawable — there is no honest way to
  // place a box without both edges — so the shape is all-or-nothing.
  const quartiles =
    min !== null && p25 !== null && median !== null && p75 !== null && max !== null
      ? { min, p25, median, p75, max }
      : null;

  const hasOwnFigure =
    typeof ownIncome === "number" && Number.isFinite(ownIncome) && ownIncome >= 0;
  const smaller = toNumber(row.smaller_count);

  if (!hasOwnFigure || smaller === null || peerCount < MIN_PEERS_FOR_PERCENTILE) {
    return { peerCount, percentile: null, quartiles };
  }

  return { peerCount, percentile: smaller / peerCount, quartiles };
}

/**
 * Position of a value on a log scale between two bounds, 0-1.
 *
 * Log, because charity income in one sector spans four orders of magnitude
 * (£100k to £124m in Health & Social Care on the staging register) and a linear
 * strip puts that sector's median client at 0.4% of the track — a chart of the
 * largest charity rather than of the distribution. Zero and negative inputs
 * clamp to the floor rather than producing -Infinity.
 */
export function logPosition(value: number, min: number, max: number): number {
  const safeMin = Math.max(min, 1);
  const safeMax = Math.max(max, safeMin + 1);
  const safeValue = Math.min(Math.max(value, safeMin), safeMax);
  const span = Math.log10(safeMax) - Math.log10(safeMin);
  if (span <= 0) return 0;
  return (Math.log10(safeValue) - Math.log10(safeMin)) / span;
}
