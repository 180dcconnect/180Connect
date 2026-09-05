/**
 * The import filter model: what the team can ask of the staged
 * companies register.
 *
 * The twin of src/lib/charity-register/filters.ts, with the differences the
 * data forces rather than taste:
 *
 * - No income bounds: the product publishes no financial figures at all.
 * - No areas of operation: a company has one registered office, so geography
 *   is postcode areas plus an optional town search — there is no second
 *   "where it works" signal to OR against.
 * - Statuses default to live companies only. The file deliberately keeps
 *   liquidations and administrations (so drift stays visible and the
 *   status-recheck job has something to compare), but importing a dissolved
 *   company is never what anyone wants. The default is shown on screen as a
 *   visible, changeable control — same honesty rule as the charity screen's
 *   unpublished-income switch.
 * - SIC codes instead of classifications: 5-digit SIC2007, validated on the
 *   way in so a typo'd code narrows to nothing loudly (count of zero, plainly
 *   shown) rather than matching the wrong thing.
 *
 * Two rules carried over unchanged:
 *   1. **Empty means everything** (within the status default). An empty SIC
 *      list is "do not filter on SIC", never "match nothing".
 *   2. Nothing here decides anything — it is a shape, a validator and a
 *      describer. Every default is "no restriction", so a filter only ever
 *      narrows the register because somebody chose that it should.
 *
 * Pure and node-testable: no database, no Supabase types, no React.
 */

import { DEFAULT_STATUSES } from "./vocabulary.ts";

export type CompanyRegisterFilters = {
  /** Free text over the company name. Empty means no name filter. */
  nameContains?: string;

  /** Multiple names or substrings to match (matches if the name contains ANY). */
  names?: string[];

  /** Free text over the registered-office town. Empty means any town. */
  townContains?: string;

  /** Company-type slugs, as the build stores them (e.g. "ltd"). Empty means any. */
  companyTypes?: string[];

  /** 5-digit SIC2007 codes. Empty means any. */
  sicCodes?: string[];

  /** Only community interest companies. Off means CICs and the rest alike. */
  cicOnly?: boolean;

  /** Postcode areas, as area tokens: ["S", "DN"]. Exact match, never prefix. */
  postcodeAreas?: string[];

  /** Incorporated on or after / before this date (YYYY-MM-DD). */
  incorporatedFrom?: string | null;
  incorporatedTo?: string | null;

  /**
   * Normalised statuses (`status_norm`). Absent means the live-only default;
   * an explicit empty list means every status. The distinction matters: the
   * default is a visible control on screen, while clearing every box is a
   * deliberate "show me the dead ones too".
   */
  statuses?: string[];
};

/** Nothing filtered — the register as it stands, live companies only. */
export const NO_FILTERS: CompanyRegisterFilters = {};

function cleanList(values: readonly string[] | undefined): string[] {
  if (!values) return [];
  const seen = new Set<string>();
  for (const value of values) {
    const trimmed = typeof value === "string" ? value.trim() : "";
    if (trimmed) seen.add(trimmed);
  }
  return [...seen];
}

function cleanSicList(values: readonly string[] | undefined): string[] {
  return cleanList(values)
    .map((value) => value.toUpperCase().replace(/[^0-9]/g, "").slice(0, 5))
    .filter((code) => /^\d{5}$/.test(code));
}

function cleanDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : null;
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
export function parseFilters(input: unknown): CompanyRegisterFilters {
  if (!input || typeof input !== "object") {
    return { statuses: [...DEFAULT_STATUSES] };
  }
  const raw = input as Record<string, unknown>;

  let incorporatedFrom = cleanDate(raw.incorporatedFrom);
  let incorporatedTo = cleanDate(raw.incorporatedTo);
  if (incorporatedFrom && incorporatedTo && incorporatedFrom > incorporatedTo) {
    [incorporatedFrom, incorporatedTo] = [incorporatedTo, incorporatedFrom];
  }

  const rawNames = cleanList(raw.names as string[] | undefined);
  const rawNameContains = typeof raw.nameContains === "string" ? raw.nameContains.trim() : "";
  let names = rawNames;
  if (names.length === 0 && rawNameContains) {
    names = rawNameContains.split(",").map((s) => s.trim()).filter(Boolean);
  }

  const statusesRaw = raw.statuses;
  const statuses =
    statusesRaw === undefined
      ? [...DEFAULT_STATUSES]
      : cleanList(statusesRaw as string[] | undefined);

  const filters: CompanyRegisterFilters = {
    nameContains: names.join(", "),
    names,
    townContains: typeof raw.townContains === "string" ? raw.townContains.trim() : "",
    companyTypes: cleanList(raw.companyTypes as string[] | undefined).map((s) =>
      s.toLowerCase(),
    ),
    sicCodes: cleanSicList(raw.sicCodes as string[] | undefined),
    cicOnly: raw.cicOnly === true,
    postcodeAreas: cleanList(raw.postcodeAreas as string[] | undefined).map((value) =>
      normalisePostcodeArea(value),
    ).filter(Boolean),
    incorporatedFrom,
    incorporatedTo,
    statuses,
  };

  return filters;
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

/** Whether any clause actually narrows the register past the live default. */
export function isUnfiltered(filters: CompanyRegisterFilters): boolean {
  const f = parseFilters(filters);
  return (
    !f.nameContains &&
    (f.names?.length ?? 0) === 0 &&
    !f.townContains &&
    (f.companyTypes?.length ?? 0) === 0 &&
    (f.sicCodes?.length ?? 0) === 0 &&
    !f.cicOnly &&
    (f.postcodeAreas?.length ?? 0) === 0 &&
    !f.incorporatedFrom &&
    !f.incorporatedTo &&
    isDefaultStatuses(f.statuses)
  );
}

function isDefaultStatuses(statuses: string[] | undefined): boolean {
  if (!statuses) return true;
  return statuses.length === DEFAULT_STATUSES.length &&
    DEFAULT_STATUSES.every((status) => statuses.includes(status));
}

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
 * words is what makes "2,000 companies" checkable before it becomes 2,000
 * rows in the client list.
 */
export function describeFilters(filters: CompanyRegisterFilters): string {
  const f = parseFilters(filters);
  if (isUnfiltered(f)) {
    return "Every live company in the staged register.";
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
  if (f.townContains) parts.push(`based in “${f.townContains}”`);

  if (f.cicOnly) parts.push("community interest companies only");
  if (f.companyTypes?.length) parts.push(`type ${joinList(f.companyTypes)}`);
  if (f.sicCodes?.length) {
    parts.push(
      f.sicCodes.length === 1
        ? `SIC ${f.sicCodes[0]}`
        : `SIC ${f.sicCodes.length} codes`,
    );
  }
  if (f.postcodeAreas?.length) {
    parts.push(`${joinList(f.postcodeAreas)} postcodes`);
  }

  if (f.incorporatedFrom && f.incorporatedTo) {
    parts.push(
      `incorporated between ${formatFilterDate(f.incorporatedFrom)} and ${formatFilterDate(f.incorporatedTo)}`,
    );
  } else if (f.incorporatedFrom) {
    parts.push(`incorporated on or after ${formatFilterDate(f.incorporatedFrom)}`);
  } else if (f.incorporatedTo) {
    parts.push(`incorporated on or before ${formatFilterDate(f.incorporatedTo)}`);
  }

  if (f.statuses && !isDefaultStatuses(f.statuses)) {
    parts.push(
      f.statuses.length === 0
        ? "including non-live companies"
        : `with status ${joinList(f.statuses)}`,
    );
  }

  const sentence = parts.join("; ");
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`;
}
