// Personal data detection and redaction (F247).
//
// F246 gave the platform a field-level deny-list: name a path in a payload and it
// is stripped before the payload is written. That answers the registry APIs, whose
// responses are objects with named fields — `officers[*].date_of_birth` is a field,
// so a field rule reaches it.
//
// It does not answer the case the risk register is actually worried about. The
// Technical Brief §5 (Data & Legal Risks, 1) says the platform must not store
// "name of trustees, personal email addresses ... in any way or form". A personal
// email address is not a field. On a scraped website it is a run of characters
// inside a blob of markup, and there is no path that names it. Deleting the field
// that contains it means deleting the page.
//
// So this module works one level down from F246: it redacts *within* string values
// rather than removing the values. `filterPayload` decides which fields survive;
// this decides what those fields are allowed to say.
//
// Two detectors, both configured as rows in `data_handling_rules` with a
// `rule_kind` of 'redact_personal_email' or 'redact_phone_number', so which
// sources and fields they run against is admin-editable without a code change
// (F246 AC3, carried forward). The detectors themselves are code — a regex is not
// something to let an admin edit into a catastrophic backtrack.
//
// ## Why emails are an allow-list when fields are a deny-list
//
// F246 argued for a deny-list and the argument was right for fields: enumerating
// every field of every registry API is impossible, and an allow-list would silently
// start dropping data each time a source added one. Availability is the failure
// direction that matters there.
//
// Email local parts invert both halves of that. The set worth keeping is small,
// closed and nameable — `info@`, `enquiries@`, `fundraising@` — while the set worth
// removing is every name any human has. And the failure direction is the opposite:
// over-keeping stores someone's personal address, over-removing costs a CAM one
// lookup on a website we also link to. So: keep a listed role address, redact
// everything else.
//
// The list lives in `public.personal_email_role_parts`, not in this file, because an
// admin adding `safeguarding@` should not need a deploy — and because the same list
// has to be readable from SQL, where the manual-entry check constraint runs. One
// table, two readers, no drift.

/** The rule kinds this module implements. Mirrors the DB check constraint. */
export type RedactionKind = "redact_personal_email" | "redact_phone_number";

/** A resolved redaction rule, as loaded from `data_handling_rules`. */
export type RedactionRule = {
  /** Null = applies to every source. */
  source: string | null;
  /** The field to scan, or `*` for every string anywhere in the payload. */
  field_path: string;
  kind: RedactionKind;
};

/**
 * What replaces a match.
 *
 * Deliberately visible rather than an empty string. A redacted payload is still
 * evidence — a CAM disputing an imported value gets shown the markup it came from
 * — and "we fetched a page with no contact details on it" and "we fetched a page
 * and removed the contact details" are different facts. The placeholder keeps them
 * different. It is also what makes the backfill idempotent: a second pass sees the
 * placeholder, not an address, and finds nothing to do.
 */
export const REDACTED_EMAIL = "[redacted:personal-email]";
export const REDACTED_PHONE = "[redacted:phone]";

/**
 * Email addresses, as they appear in prose and in markup.
 *
 * Intentionally looser than a validating pattern: the goal is to find things that
 * would read as an address to a human, not to accept only addresses RFC 5322
 * allows. A false positive here removes a string that looked like an email, which
 * is the safe direction.
 */
const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/**
 * UK and international telephone numbers.
 *
 * Anchored on `+44`, `0044` or a leading `0` and nothing else, which is the whole
 * reason this does not eat the identifiers the platform exists to collect. A bare
 * `\d{6,11}` would match charity number 1164883, company number 15874544, a
 * postcode-free address, a year range and a donation amount. Registration numbers
 * never start with a zero in the formats this platform handles, so requiring one
 * separates them cleanly.
 *
 * Separators are optional and mixed on real sites: `0114 222 1234`,
 * `+44 (0)114 222 1234`, `0114-222-1234`.
 */
const PHONE_PATTERN =
  /(?:\+44|0044|\+\d{1,3}[ -]?\(0\)|0)(?:[ ().-]?\d){8,12}\b/g;

/**
 * Splits an email local part into the words it is built from.
 *
 * `fundraising.team`, `info-sheffield` and `enquiries_2024` are all role addresses
 * wearing a suffix, and a set lookup on the whole local part misses every one of
 * them. Splitting on the separators people actually use catches them without
 * loosening the match to a substring test, which would keep `joanne@` for
 * containing `jo`.
 */
function localPartWords(localPart: string): string[] {
  return localPart
    .toLowerCase()
    .split(/[._\-+]/)
    .filter((word) => word.length > 0);
}

/**
 * Is this address a person's, rather than a role's?
 *
 * True — meaning "redact" — unless some word of the local part is a known role.
 * Unknown is treated as personal: see the allow-list reasoning in the header.
 *
 * A malformed string with no `@` is not an address and is left alone; the caller
 * only reaches here for something EMAIL_PATTERN already matched, but this is
 * exported and the manual-entry path passes whatever a CAM typed.
 */
export function isPersonalEmail(
  address: string,
  roleLocalParts: ReadonlySet<string>,
): boolean {
  const at = address.lastIndexOf("@");
  if (at <= 0) return false;

  const words = localPartWords(address.slice(0, at));
  if (words.length === 0) return false;

  return !words.some((word) => roleLocalParts.has(word));
}

export type RedactionCounts = Partial<Record<RedactionKind, number>>;

/**
 * Redacts one string, returning it alongside what was found.
 *
 * The counts are counts. The matched values are never returned, logged or stored
 * anywhere — that would reintroduce the personal data into the audit trail, which
 * is the one place nobody thinks to look for it.
 */
export function redactText(
  text: string,
  kinds: ReadonlySet<RedactionKind>,
  roleLocalParts: ReadonlySet<string>,
): { text: string; counts: RedactionCounts } {
  const counts: RedactionCounts = {};
  let result = text;

  if (kinds.has("redact_personal_email")) {
    result = result.replace(EMAIL_PATTERN, (match) => {
      if (!isPersonalEmail(match, roleLocalParts)) return match;
      counts.redact_personal_email = (counts.redact_personal_email ?? 0) + 1;
      return REDACTED_EMAIL;
    });
  }

  if (kinds.has("redact_phone_number")) {
    result = result.replace(PHONE_PATTERN, () => {
      counts.redact_phone_number = (counts.redact_phone_number ?? 0) + 1;
      return REDACTED_PHONE;
    });
  }

  return { text: result, counts };
}

/**
 * Which redaction rules apply to a source, grouped by the field they scan.
 *
 * Same precedence question as `resolveRulesForSource` in field-filter.ts, and the
 * same answer — a source-specific rule beats a global one — except that redaction
 * rules accumulate rather than override: two kinds can legitimately target the
 * same field, and both should run.
 */
export function resolveRedactionsForSource(
  rules: RedactionRule[],
  source: string,
): Map<string, Set<RedactionKind>> {
  const byField = new Map<string, Set<RedactionKind>>();

  for (const rule of rules) {
    if (rule.source !== null && rule.source !== source) continue;

    const existing = byField.get(rule.field_path);
    if (existing) {
      existing.add(rule.kind);
    } else {
      byField.set(rule.field_path, new Set([rule.kind]));
    }
  }

  return byField;
}

export type RedactionResult = {
  /** The payload with matches replaced. Structurally identical to the input. */
  redacted: unknown;
  /**
   * What ran and matched, as `<field_path>#<kind>` entries.
   *
   * The same array that F246 writes to `raw_source_records.excluded_fields`, so
   * `data_handling_filter_summary()` reports redactions beside field removals with
   * no schema change and no second admin screen. The `#` is what tells the two
   * apart when reading that column: a field rule contributes a bare path.
   */
  applied: string[];
  /** Per-kind match totals across the whole payload. */
  counts: RedactionCounts;
};

function addCounts(into: RedactionCounts, from: RedactionCounts): void {
  for (const [kind, count] of Object.entries(from) as [
    RedactionKind,
    number,
  ][]) {
    into[kind] = (into[kind] ?? 0) + count;
  }
}

/**
 * Walks a value and redacts every string in it.
 *
 * Used for the `*` field path, which is what a scraped page needs: the address is
 * somewhere in the markup and no path names where. Arrays and nested objects are
 * rebuilt rather than mutated, so the caller's payload is untouched if nothing
 * matched.
 */
function redactEverywhere(
  value: unknown,
  kinds: ReadonlySet<RedactionKind>,
  roleLocalParts: ReadonlySet<string>,
  counts: RedactionCounts,
): unknown {
  if (typeof value === "string") {
    const { text, counts: found } = redactText(value, kinds, roleLocalParts);
    addCounts(counts, found);
    return text;
  }

  // Containers are rebuilt only when a descendant actually changed. Returning a
  // fresh object either way would be correct by value and wrong in effect: the
  // caller checksums what comes back, and a payload nothing matched in has to keep
  // the checksum it already has or the backfill rewrites every row it scans.
  if (Array.isArray(value)) {
    let changed = false;
    const out = value.map((element) => {
      const next = redactEverywhere(element, kinds, roleLocalParts, counts);
      if (next !== element) changed = true;
      return next;
    });
    return changed ? out : value;
  }

  if (value !== null && typeof value === "object") {
    let changed = false;
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      const next = redactEverywhere(child, kinds, roleLocalParts, counts);
      if (next !== child) changed = true;
      out[key] = next;
    }
    return changed ? out : value;
  }

  return value;
}

/**
 * Redacts one named field, leaving the rest of the payload alone.
 *
 * Dot-separated, and deliberately without the `[*]` array wildcard that field
 * paths support: a redaction rule that needs to reach into every element of an
 * array is a rule that wants `*`, and supporting two ways to say the same thing
 * invites a rule that says one and means the other.
 */
function redactAtPath(
  value: unknown,
  segments: string[],
  index: number,
  kinds: ReadonlySet<RedactionKind>,
  roleLocalParts: ReadonlySet<string>,
  counts: RedactionCounts,
): { value: unknown; changed: boolean } {
  if (index >= segments.length) {
    const before = { ...counts };
    const next = redactEverywhere(value, kinds, roleLocalParts, counts);
    const changed = JSON.stringify(before) !== JSON.stringify(counts);
    return { value: next, changed };
  }

  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { value, changed: false };
  }

  const obj = value as Record<string, unknown>;
  const key = segments[index];
  if (!(key in obj)) return { value, changed: false };

  const result = redactAtPath(
    obj[key],
    segments,
    index + 1,
    kinds,
    roleLocalParts,
    counts,
  );
  if (!result.changed) return { value, changed: false };

  return { value: { ...obj, [key]: result.value }, changed: true };
}

/**
 * Applies every redaction rule that covers this source to a payload.
 *
 * Returns the payload unchanged, and `applied` empty, when nothing matched — which
 * is what keeps the checksum stable for the overwhelming majority of records and
 * stops the backfill rewriting rows it has nothing to do to.
 */
export function redactPayload(
  payload: unknown,
  rules: RedactionRule[],
  source: string,
  roleLocalParts: ReadonlySet<string>,
): RedactionResult {
  const byField = resolveRedactionsForSource(rules, source);
  if (byField.size === 0) {
    return { redacted: payload, applied: [], counts: {} };
  }

  let current = payload;
  const applied: string[] = [];
  const totals: RedactionCounts = {};

  for (const [fieldPath, kinds] of byField) {
    const counts: RedactionCounts = {};

    if (fieldPath === "*") {
      current = redactEverywhere(current, kinds, roleLocalParts, counts);
    } else {
      const result = redactAtPath(
        current,
        fieldPath.split("."),
        0,
        kinds,
        roleLocalParts,
        counts,
      );
      current = result.value;
    }

    // One entry per kind that actually matched, not per kind that ran. A rule
    // recorded on every row it was merely checked against would make
    // `data_handling_filter_summary()` useless for its one job — telling an admin
    // which rules are earning their place.
    for (const kind of kinds) {
      if (counts[kind]) applied.push(`${fieldPath}#${kind}`);
    }
    addCounts(totals, counts);
  }

  return { redacted: current, applied, counts: totals };
}
