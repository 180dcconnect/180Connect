/**
 * F066 — what a saved filter view is made of, kept out of the route and the server
 * action so both sides agree on one definition and it can be tested without a
 * database.
 *
 * A view is the /clients filter combination under a name. Every filter on that page
 * is already a URL search param (see src/app/clients/page.tsx), so capturing a view
 * is "take the params we recognise" and re-applying one is "put them back in a query
 * string". Nothing in between interprets them, which is what makes AC2 — the same
 * combination comes back exactly — true by construction rather than by care.
 */

/**
 * The params a view remembers, and the order they are written back in.
 *
 * These are the AC's filter list mapped onto the params the page actually uses:
 * search (`q`), location (`city` and `country`), outreach status (`status`),
 * organisation type (`type`), and owner (`owner`). Since F053/F054/F056 the four
 * location/status/type filters are multi-select — the URL carries each chosen value
 * as a repeated param, so a view stores an array for those keys and `savedViewHref`
 * writes the repeats back.
 *
 * Sector is absent because there is no sector filter to capture: ORGANISATIONS has
 * no sector column (it lives on ENRICHMENT_RESULTS, LLM-classified) and F055 (#57)
 * is unbuilt. Adding it here later is a one-line change and no migration, which is
 * the reason the column is jsonb.
 *
 * Deliberately not captured: `page`, the insight band's `stage`/`sort`/`dir`, and
 * the list's own `listSort`/`listDir`. A saved view is a filter combination — the AC
 * says so — and pinning someone to page 4 of a list whose contents have since
 * changed is a bug, not a feature. Ordering is how the same list is read, not what
 * is in it.
 */
export const SAVED_VIEW_FILTER_KEYS = [
  "q",
  "city",
  "country",
  "status",
  "type",
  "owner",
] as const;

/** Keys whose URL form is a repeated param, stored as arrays in `filters`. */
export const SAVED_VIEW_MULTI_KEYS: readonly SavedViewFilterKey[] = [
  "city",
  "country",
  "status",
  "type",
];

export type SavedViewFilterKey = (typeof SAVED_VIEW_FILTER_KEYS)[number];

export type SavedViewFilterValue = string | string[];

export type SavedViewFilters = Partial<Record<SavedViewFilterKey, SavedViewFilterValue>>;

/** Longest a single filter value may be. Comfortably past any real city or status. */
export const MAX_FILTER_VALUE_LENGTH = 200;

/**
 * Most values one multi-select key may hold. The DB caps a whole row at 4 KB; this
 * keeps one key from eating it and matches any sane use of the dropdowns.
 */
export const MAX_FILTER_VALUES_PER_KEY = 20;

/** Longest a view name may be. Mirrors the DB check constraint and the input's maxlength. */
export const MAX_VIEW_NAME_LENGTH = 60;

/**
 * How many views one CAM may keep. Not a DB constraint — a per-user count is
 * awkward to enforce in a check and this is a courtesy limit, not a security one.
 * The point is that a stuck form or a script cannot grow the list without bound.
 */
export const MAX_SAVED_VIEWS = 30;

const FILTER_KEY_SET = new Set<string>(SAVED_VIEW_FILTER_KEYS);
const MULTI_KEY_SET = new Set<string>(SAVED_VIEW_MULTI_KEYS);

function usable(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > MAX_FILTER_VALUE_LENGTH) return null;
  return trimmed;
}

function usableList(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const values: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== "string") continue;
    const value = usable(entry);
    // A duplicate adds nothing the URL would not carry twice anyway.
    if (value && !values.includes(value)) values.push(value);
    if (values.length === MAX_FILTER_VALUES_PER_KEY) break;
  }
  return values;
}

/**
 * Reads a filter set out of anything shaped like search params — the page's
 * awaited `searchParams`, or a FormData snapshot of them.
 *
 * Whitelists on the way in: an unknown param is dropped rather than stored, so a
 * tampered POST cannot use this table as free key-value storage, and a param the
 * page later stops honouring cannot linger in someone's saved view pretending to
 * filter something. Empty and whitespace-only values are dropped too — they are how
 * "no filter" arrives from a cleared input, and storing them would make an empty
 * view look like a filtered one.
 */
export function captureFilters(
  input: Partial<Record<string, string | string[] | undefined>>,
): SavedViewFilters {
  const filters: SavedViewFilters = {};
  for (const key of SAVED_VIEW_FILTER_KEYS) {
    const raw = input[key];
    if (raw == null) continue;
    if (MULTI_KEY_SET.has(key) || Array.isArray(raw)) {
      const values = usableList(Array.isArray(raw) ? raw : [raw]);
      if (values && values.length > 0) filters[key] = values;
      continue;
    }
    if (typeof raw !== "string") continue;
    const value = usable(raw);
    if (value) filters[key] = value;
  }
  return filters;
}

/**
 * Reads a filter set back out of the `filters` jsonb column.
 *
 * The same whitelist as the write path, applied again rather than trusted: the
 * column is jsonb, so Postgres guarantees only that it is an object (see the
 * migration's check constraint). A row written by an older or a hostile client can
 * hold anything; what it must never do is render as a filter the CAM cannot see. An
 * unknown key, a non-string value, or an over-long one is ignored, and the view
 * simply applies the filters that survived. Multi-select keys accept either a
 * single string or an array, so a row from before F053/F054/F056 still reads.
 */
export function parseFilters(value: unknown): SavedViewFilters {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const source = value as Record<string, unknown>;
  const filters: SavedViewFilters = {};
  for (const [key, raw] of Object.entries(source)) {
    if (!FILTER_KEY_SET.has(key)) continue;
    if (MULTI_KEY_SET.has(key)) {
      if (typeof raw === "string") {
        const value = usable(raw);
        if (value) filters[key as SavedViewFilterKey] = [value];
      } else {
        const values = usableList(raw);
        if (values && values.length > 0) filters[key as SavedViewFilterKey] = values;
      }
      continue;
    }
    if (typeof raw !== "string") continue;
    const value = usable(raw);
    if (value) filters[key as SavedViewFilterKey] = value;
  }
  return filters;
}

/**
 * The link that re-applies a view: /clients with exactly this view's filters and
 * nothing else.
 *
 * "Nothing else" is the point — a view is applied by navigating to a URL built only
 * from what it stored, so whatever was on screen beforehand (another view's filters,
 * a page number) cannot leak into it and make the result differ from the moment it
 * was saved. Key order follows SAVED_VIEW_FILTER_KEYS so the same view always
 * produces the same string, which is what lets `isCurrentView` compare hrefs.
 * Multi-select keys are written as repeated params, exactly how the page's own
 * links write them.
 */
export function savedViewHref(filters: SavedViewFilters): string {
  const params = new URLSearchParams();
  for (const key of SAVED_VIEW_FILTER_KEYS) {
    const value = filters[key];
    if (Array.isArray(value)) {
      value.forEach((entry) => params.append(key, entry));
    } else if (value) {
      params.set(key, value);
    }
  }
  const qs = params.toString();
  return qs ? `/clients?${qs}` : "/clients";
}

/** Whether two filter sets are the same combination, key for key. */
export function filtersMatch(a: SavedViewFilters, b: SavedViewFilters): boolean {
  return SAVED_VIEW_FILTER_KEYS.every((key) => {
    const left = a[key];
    const right = b[key];
    if (Array.isArray(left) || Array.isArray(right)) {
      const l = Array.isArray(left) ? left : [];
      const r = Array.isArray(right) ? right : [];
      return l.length === r.length && l.every((entry, index) => entry === r[index]);
    }
    return (left ?? "") === (right ?? "");
  });
}

/** Whether a view is the one currently applied to the list. */
export function isCurrentView(
  view: SavedViewFilters,
  active: SavedViewFilters,
): boolean {
  return filtersMatch(view, active);
}

/** How many keys a view sets — 0 means it is the unfiltered list. */
export function filterCount(filters: SavedViewFilters): number {
  return SAVED_VIEW_FILTER_KEYS.filter((key) => {
    const value = filters[key];
    return Array.isArray(value) ? value.length > 0 : Boolean(value);
  }).length;
}

/** One label per value of a multi-select key, joined for display. */
function describeValues(value: SavedViewFilterValue): string {
  return (Array.isArray(value) ? value : [value]).join(", ");
}

/**
 * A one-line human reading of a filter set, for the row under a view's name.
 *
 * `ownerName` is passed in rather than looked up here: `owner` stores a user id, and
 * this module does not talk to the database. An id with no matching team member (a
 * deactivated CAM, someone the caller cannot see) reads as "a former team member" —
 * the same wording visible-clients.ts uses for the same situation, rather than
 * showing a raw uuid.
 */
export function describeFilters(
  filters: SavedViewFilters,
  ownerName?: string | null,
): string {
  const parts: string[] = [];
  if (filters.q) parts.push(`“${filters.q}”`);
  if (filters.type) parts.push(describeValues(filters.type));
  if (filters.city) parts.push(describeValues(filters.city));
  if (filters.country) parts.push(describeValues(filters.country));
  if (filters.status) parts.push(describeValues(filters.status));
  if (filters.owner === "unassigned") {
    parts.push("Unassigned");
  } else if (filters.owner) {
    parts.push(ownerName || "A former team member");
  }
  return parts.length > 0 ? parts.join(" · ") : "No filters — the whole list";
}

/**
 * Trims a submitted view name to what the column will accept, or returns null when
 * there is nothing usable there. Blank-after-trim is the case that matters: the DB
 * check constraint rejects it, and catching it here turns a Postgres error into an
 * ordinary form message.
 */
export function normalizeViewName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > MAX_VIEW_NAME_LENGTH) return null;
  return trimmed;
}
