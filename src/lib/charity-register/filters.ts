/**
 * The import filter model: what the team can ask of the staged register.
 *
 * This replaces charity-commission-bulk-config.ts, which held the same decisions
 * as TypeScript constants applied inside a streaming download. Nothing here
 * decides anything — it is a shape, a validator and a describer. Every default
 * is "no restriction", so a filter only ever narrows the register because
 * somebody chose that it should.
 *
 * Two rules this module exists to enforce:
 *
 *   1. **Empty means everything.** An empty classification list is not "match
 *      nothing", it is "do not filter on classification at all". The old config
 *      got this backwards by construction: it had no way to express "any
 *      sector", because the list was the whitelist.
 *   2. **Null income is its own decision.** The register leaves `latest_income`
 *      null when it publishes no figure — 238 of the 4,340 charities local to
 *      the branch. Treating that as zero silently excluded all of them from
 *      every import. `includeUnpublishedIncome` makes it a switch on screen.
 *
 * Pure and node-testable: no database, no Supabase types, no React.
 */

/** The register's own three classification dimensions. */
export type ClassificationDimension = "what" | "who" | "how";

/** The register's own three area-of-operation levels. */
export type AreaLevel = "localAuthority" | "region" | "country";

export type CharityRegisterFilters = {
  /** Free text over the charity's name. Empty means no name filter. */
  nameContains?: string;

  /** Multiple names or substrings to match (matches if charity name contains ANY of these). */
  names?: string[];

  /** Inclusive bounds on latest published income, in pounds. */
  incomeMin?: number | null;
  incomeMax?: number | null;
  /**
   * Whether charities whose income the register does not publish are included.
   *
   * Defaults to **true** — including them is the honest reading of a null, and
   * excluding them is a decision that should have to be made deliberately. Only
   * consulted when an income bound is actually set: with no bounds there is
   * nothing to exclude them from.
   */
  includeUnpublishedIncome?: boolean;

  /** Registered on or after / before this date (YYYY-MM-DD). */
  registeredFrom?: string | null;
  registeredTo?: string | null;

  /**
   * Postcode areas, as area tokens: ["S", "DN"]. Compared exactly against the
   * stored `postcode_area`, never as a prefix.
   */
  postcodeAreas?: string[];

  /** Areas of operation the charity declares, by the register's own level. */
  areas?: Partial<Record<AreaLevel, string[]>>;

  /** Classifications, by the register's own dimension. */
  classifications?: Partial<Record<ClassificationDimension, string[]>>;

  /**
   * How the location clauses combine with each other.
   *
   * "any" (the default) matches a charity that satisfies *either* the postcode
   * areas or the declared areas of operation. That is deliberate and it is what
   * the old code did for good reason: a Sheffield charity that never filled in
   * its area of operation is still on the doorstep, and a nationally-addressed
   * charity that names Sheffield as an area is still working here.
   *
   * "all" requires both, for the rarer case of wanting charities that are both
   * based in and working in a place.
   */
  locationMatch?: "any" | "all";

  /** Charity types (register wording, e.g. "CIO"). Empty means any. */
  charityTypes?: string[];

  /** Only charities that have at least one filed annual return. */
  hasFiledAccounts?: boolean;

  /**
   * Exclude charities the register flags as insolvent or in administration.
   * Off by default: it is a judgement about who is worth approaching, and this
   * module does not make those.
   */
  excludeInsolvent?: boolean;
};

/** Nothing filtered — the register as it stands. */
export const NO_FILTERS: CharityRegisterFilters = {};

/**
 * The registration statuses a snapshot row can hold. Every import is implicitly
 * restricted to "Registered" charities that are not linked subsidiary rows;
 * those are not filters the team chooses but facts about what an importable
 * charity is, so they live in the query rather than in this model.
 */
export const IMPORTABLE_REGISTRATION_STATUS = "Registered";

function cleanList(values: readonly string[] | undefined): string[] {
  if (!values) return [];
  const seen = new Set<string>();
  for (const value of values) {
    const trimmed = typeof value === "string" ? value.trim() : "";
    if (trimmed) seen.add(trimmed);
  }
  return [...seen];
}

function cleanNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  // Negative income is not a thing the register publishes, and a negative bound
  // is almost always a typo that would silently widen rather than narrow.
  return value < 0 ? null : value;
}

function cleanDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : null;
}

/**
 * Postcode areas are the letters before the first digit. Accepts what someone
 * would actually type — "s", "S1 2HE", " dn " — and stores the area token.
 */
export function normalisePostcodeArea(value: string): string {
  const compact = value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const withDigit = /^([A-Z]{1,2})\d/.exec(compact);
  if (withDigit) return withDigit[1];
  return /^[A-Z]{1,2}$/.test(compact) ? compact : "";
}

/**
 * Coerces anything — a saved preset out of jsonb, a submitted form — into a
 * filter set that the query builder can trust.
 *
 * Never throws and never rejects: an unreadable clause is dropped rather than
 * failing the whole filter, because the consequence of dropping one is a wider
 * result the user can see and correct, while the consequence of throwing is a
 * screen that will not load. Bounds that arrive the wrong way round are
 * swapped rather than discarded.
 */
export function parseFilters(input: unknown): CharityRegisterFilters {
  if (!input || typeof input !== "object") return {};
  const raw = input as Record<string, unknown>;

  let incomeMin = cleanNumber(raw.incomeMin);
  let incomeMax = cleanNumber(raw.incomeMax);
  if (incomeMin !== null && incomeMax !== null && incomeMin > incomeMax) {
    [incomeMin, incomeMax] = [incomeMax, incomeMin];
  }

  let registeredFrom = cleanDate(raw.registeredFrom);
  let registeredTo = cleanDate(raw.registeredTo);
  if (registeredFrom && registeredTo && registeredFrom > registeredTo) {
    [registeredFrom, registeredTo] = [registeredTo, registeredFrom];
  }

  const areasInput = (raw.areas ?? {}) as Record<string, unknown>;
  const classificationsInput = (raw.classifications ?? {}) as Record<string, unknown>;

  const rawNames = cleanList(raw.names as string[] | undefined)
    .map((s) => s.trim())
    .filter(Boolean);
  const rawNameContains = typeof raw.nameContains === "string" ? raw.nameContains.trim() : "";
  let names = rawNames;
  if (names.length === 0 && rawNameContains) {
    names = rawNameContains.split(",").map((s) => s.trim()).filter(Boolean);
  }

  const filters: CharityRegisterFilters = {
    nameContains: names.join(", "),
    names,
    incomeMin,
    incomeMax,
    // Absent means true. Only an explicit `false` turns it off, so a preset
    // saved before this switch existed keeps the inclusive behaviour.
    includeUnpublishedIncome: raw.includeUnpublishedIncome !== false,
    registeredFrom,
    registeredTo,
    postcodeAreas: cleanList(raw.postcodeAreas as string[] | undefined)
      .map(normalisePostcodeArea)
      .filter(Boolean),
    areas: {
      localAuthority: cleanList(areasInput.localAuthority as string[] | undefined),
      region: cleanList(areasInput.region as string[] | undefined),
      country: cleanList(areasInput.country as string[] | undefined),
    },
    classifications: {
      what: cleanList(classificationsInput.what as string[] | undefined),
      who: cleanList(classificationsInput.who as string[] | undefined),
      how: cleanList(classificationsInput.how as string[] | undefined),
    },
    locationMatch: raw.locationMatch === "all" ? "all" : "any",
    charityTypes: cleanList(raw.charityTypes as string[] | undefined),
    hasFiledAccounts: raw.hasFiledAccounts === true,
    excludeInsolvent: raw.excludeInsolvent === true,
  };

  return filters;
}

/** Whether any clause actually narrows the register. */
export function isUnfiltered(filters: CharityRegisterFilters): boolean {
  const f = parseFilters(filters);
  return (
    !f.nameContains &&
    (f.names?.length ?? 0) === 0 &&
    f.incomeMin === null &&
    f.incomeMax === null &&
    !f.registeredFrom &&
    !f.registeredTo &&
    (f.postcodeAreas?.length ?? 0) === 0 &&
    (f.areas?.localAuthority?.length ?? 0) === 0 &&
    (f.areas?.region?.length ?? 0) === 0 &&
    (f.areas?.country?.length ?? 0) === 0 &&
    (f.classifications?.what?.length ?? 0) === 0 &&
    (f.classifications?.who?.length ?? 0) === 0 &&
    (f.classifications?.how?.length ?? 0) === 0 &&
    (f.charityTypes?.length ?? 0) === 0 &&
    !f.hasFiledAccounts
  );
}

const MONEY = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  maximumFractionDigits: 0,
});

function joinList(values: string[], conjunction = "or"): string {
  if (values.length === 1) return values[0];
  if (values.length === 2) return `${values[0]} ${conjunction} ${values[1]}`;
  return `${values.slice(0, -1).join(", ")}, ${conjunction} ${values[values.length - 1]}`;
}

function formatFilterDate(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  if (!year || !month || !day) return iso;
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Turns a filter set back into one plain-English sentence.
 *
 * Used above the sample table and in the confirmation prompt: the headline
 * count alone does not say what was asked for. Writing the criteria back in
 * words is what makes "2,000 charities" checkable before it becomes 2,000 rows
 * in the client list.
 */
export function describeFilters(filters: CharityRegisterFilters): string {
  const f = parseFilters(filters);
  if (isUnfiltered(f)) {
    return f.excludeInsolvent
      ? "Every solvent registered charity in England and Wales."
      : "Every registered charity in England and Wales.";
  }

  const parts: string[] = [];

  if (f.names && f.names.length > 0) {
    if (f.names.length === 1) {
      parts.push(`name contains “${f.names[0]}”`);
    } else {
      parts.push(`name contains ${f.names.map((n) => `“${n}”`).join(" or ")}`);
    }
  } else if (f.nameContains) {
    parts.push(`name contains “${f.nameContains}”`);
  }

  if (f.incomeMin !== null && f.incomeMax !== null) {
    parts.push(`income ${MONEY.format(f.incomeMin!)}–${MONEY.format(f.incomeMax!)}`);
  } else if (f.incomeMin !== null) {
    parts.push(`income at least ${MONEY.format(f.incomeMin!)}`);
  } else if (f.incomeMax !== null) {
    parts.push(`income up to ${MONEY.format(f.incomeMax!)}`);
  }
  if (
    (f.incomeMin !== null || f.incomeMax !== null) &&
    f.includeUnpublishedIncome === false
  ) {
    parts.push("excluding charities with no published income");
  }

  if (f.registeredFrom && f.registeredTo) {
    parts.push(`registered between ${formatFilterDate(f.registeredFrom)} and ${formatFilterDate(f.registeredTo)}`);
  } else if (f.registeredFrom) {
    parts.push(`registered on or after ${formatFilterDate(f.registeredFrom)}`);
  } else if (f.registeredTo) {
    parts.push(`registered on or before ${formatFilterDate(f.registeredTo)}`);
  }

  const locationClauses: string[] = [];
  if (f.postcodeAreas?.length) {
    locationClauses.push(`${joinList(f.postcodeAreas)} postcodes`);
  }
  const declaredAreas = [
    ...(f.areas?.localAuthority ?? []),
    ...(f.areas?.region ?? []),
    ...(f.areas?.country ?? []),
  ];
  if (declaredAreas.length) {
    locationClauses.push(`operating in ${joinList(declaredAreas)}`);
  }
  if (locationClauses.length) {
    parts.push(joinList(locationClauses, f.locationMatch === "all" ? "and" : "or"));
  }

  for (const [dimension, label] of [
    ["what", "doing"],
    ["who", "helping"],
    ["how", "working by"],
  ] as const) {
    const values = f.classifications?.[dimension] ?? [];
    if (values.length) parts.push(`${label} ${joinList(values)}`);
  }

  if (f.charityTypes?.length) parts.push(`type ${joinList(f.charityTypes)}`);
  if (f.hasFiledAccounts) parts.push("with at least one filed annual return");
  if (f.excludeInsolvent) parts.push("excluding insolvent charities");

  const sentence = parts.join("; ");
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`;
}
