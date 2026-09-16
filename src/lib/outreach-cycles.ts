/**
 * Outreach cycles — named stretches of time ("Spring 26") that analytics
 * compares.
 *
 * Everything here is pure: parsing an admin's input, the non-overlap rule,
 * and deriving "which cycle does this event belong to" from dates. The writes
 * live in the settings actions; the reads filter timestamped rows through
 * `cycleWindow`/`withinWindow`. Nothing here touches a database or a clock,
 * so it is tested directly with node:test.
 *
 * ── The one load-bearing decision ──
 *
 * Membership is derived at read time, never stamped on a row. An event belongs
 * to the cycle its date falls inside — which is what makes a cycle defined
 * tomorrow sort all of history with no backfill, and what makes moving a
 * cycle's dates re-label rather than rewrite. The price is stated where it is
 * shown: ownership, pipeline and sector figures are point-in-time and stay
 * "as of today" while activity filters to the cycle.
 */

export type OutreachCycle = {
  id: string;
  name: string;
  /** Inclusive first day, YYYY-MM-DD. */
  starts_on: string;
  /** Inclusive last day, YYYY-MM-DD. */
  ends_on: string;
};

/** Half-open UTC window `[startMs, endMs)` for an inclusive date range. */
export type CycleWindow = { startMs: number; endMs: number };

const DAY_MS = 24 * 60 * 60 * 1000;

/** Long enough for "Autumn Outreach 2025", short enough to stay a label. */
export const MAX_CYCLE_NAME_CHARS = 80;

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * A real calendar day in YYYY-MM-DD form, or null. `Date.parse` alone is not
 * enough — it normalises "2026-02-30" into March rather than rejecting it —
 * so the parts are round-tripped through UTC and must come back identical.
 */
export function parseCycleDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = ISO_DAY.exec(value.trim());
  if (!match) return null;
  const [, year, month, day] = match.map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const built = new Date(Date.UTC(year, month - 1, day));
  if (
    built.getUTCFullYear() !== year ||
    built.getUTCMonth() !== month - 1 ||
    built.getUTCDate() !== day
  ) {
    return null;
  }
  return `${match[1]}-${match[2]}-${match[3]}`;
}

export type ParsedCycleInput = { name: string; startsOn: string; endsOn: string };

/**
 * Coerces anything the settings form sent into a cycle, or one plain-English
 * sentence saying why not. Never throws: a bad shape is a message, not a 500.
 */
export function parseCycleInput(
  input: unknown,
): { ok: true; data: ParsedCycleInput } | { ok: false; message: string } {
  if (!input || typeof input !== "object") {
    return { ok: false, message: "That cycle could not be read. Try again." };
  }
  const raw = input as Record<string, unknown>;
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (!name) return { ok: false, message: "Give the cycle a name, e.g. Spring 26." };
  if (name.length > MAX_CYCLE_NAME_CHARS) {
    return {
      ok: false,
      message: `Keep the name under ${MAX_CYCLE_NAME_CHARS} characters.`,
    };
  }
  const startsOn = parseCycleDate(raw.startsOn);
  const endsOn = parseCycleDate(raw.endsOn);
  if (!startsOn || !endsOn) {
    return { ok: false, message: "Pick a valid first and last day for the cycle." };
  }
  if (startsOn > endsOn) {
    return { ok: false, message: "The last day cannot be before the first day." };
  }
  return { ok: true, data: { name, startsOn, endsOn } };
}

/** Whether two inclusive date ranges share at least one day. */
export function cyclesOverlap(
  a: Pick<OutreachCycle, "starts_on" | "ends_on">,
  b: Pick<OutreachCycle, "starts_on" | "ends_on">,
): boolean {
  return a.starts_on <= b.ends_on && b.starts_on <= a.ends_on;
}

/**
 * Where a cycle sits relative to a given day: after it, inside it, or past it.
 *
 * The settings list answers this at a glance — "In progress", "Starts 12 Jan
 * 2026", "Finished" — so nobody has to read two dates and work out the answer.
 * Inclusive at both ends, matching `cycleWindow` exactly: the last day counts.
 *
 * The day is a parameter rather than a clock read, because the same function
 * runs in a test, on the server and (for the candidate dates being picked in
 * the browser) everywhere else. Nothing here calls `new Date()`.
 */
export type CyclePhase = "upcoming" | "running" | "finished";

export function cyclePhase(
  cycle: Pick<OutreachCycle, "starts_on" | "ends_on">,
  today: string,
): CyclePhase {
  if (today < cycle.starts_on) return "upcoming";
  if (today > cycle.ends_on) return "finished";
  return "running";
}

/**
 * The existing cycle already using this name, if any — skipping `ignoreId` so
 * renaming a cycle to the name it already has is not a clash with itself.
 *
 * Case- and whitespace-insensitive, because that is exactly what the table's
 * `name_key` generated column enforces: ``" spring 26 "`` cannot sit beside
 * "Spring 26". Checking the same rule here means the form can say so before
 * the save is attempted rather than after it is refused.
 */
export function findCycleByName(
  cycles: readonly OutreachCycle[],
  name: string,
  ignoreId?: string,
): OutreachCycle | null {
  const key = name.trim().toLowerCase();
  if (!key) return null;
  for (const cycle of cycles) {
    if (cycle.id === ignoreId) continue;
    if (cycle.name.trim().toLowerCase() === key) return cycle;
  }
  return null;
}

/**
 * The existing cycle a candidate would collide with, if any — skipping
 * `ignoreId` so saving a cycle's own dates back is not a collision with
 * itself. The app refuses the save in plain words; the database carries no
 * exclusion constraint, so this check is the whole enforcement.
 */
export function findCycleOverlap(
  cycles: readonly OutreachCycle[],
  candidate: Pick<OutreachCycle, "starts_on" | "ends_on">,
  ignoreId?: string,
): OutreachCycle | null {
  for (const cycle of cycles) {
    if (cycle.id === ignoreId) continue;
    if (cyclesOverlap(cycle, candidate)) return cycle;
  }
  return null;
}

/** An inclusive date range as a half-open UTC window, for exact filtering. */
export function cycleWindow(cycle: Pick<OutreachCycle, "starts_on" | "ends_on">): CycleWindow {
  const startMs = Date.parse(`${cycle.starts_on}T00:00:00Z`);
  return { startMs, endMs: Date.parse(`${cycle.ends_on}T00:00:00Z`) + DAY_MS };
}

/** Whether a timestamp falls inside a window. Unreadable dates match nothing. */
export function withinWindow(iso: string | null | undefined, window: CycleWindow): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  return !Number.isNaN(t) && t >= window.startMs && t < window.endMs;
}

/** The rows whose date falls inside the window, in their original order. */
export function filterByWindow<T>(
  rows: readonly T[],
  getIso: (row: T) => string | null | undefined,
  window: CycleWindow,
): T[] {
  return rows.filter((row) => withinWindow(getIso(row), window));
}

/** The cycle an event timestamp belongs to, or null outside every cycle. */
export function cycleContaining(
  cycles: readonly OutreachCycle[],
  iso: string | null | undefined,
): OutreachCycle | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  for (const cycle of cycles) {
    const window = cycleWindow(cycle);
    if (t >= window.startMs && t < window.endMs) return cycle;
  }
  return null;
}

/** Cycles oldest-first, for pickers and for finding "the previous one". */
export function orderCyclesByStart(cycles: readonly OutreachCycle[]): OutreachCycle[] {
  return [...cycles].sort(
    (a, b) =>
      a.starts_on.localeCompare(b.starts_on) ||
      a.ends_on.localeCompare(b.ends_on) ||
      a.name.localeCompare(b.name),
  );
}

/**
 * The latest cycle ending strictly before this one starts — the default
 * comparison partner ("Spring 26 vs Autumn 25" without being asked twice).
 * Null when there is nothing earlier to compare against.
 */
export function previousCycle(
  cycles: readonly OutreachCycle[],
  cycle: Pick<OutreachCycle, "starts_on">,
): OutreachCycle | null {
  let previous: OutreachCycle | null = null;
  for (const candidate of cycles) {
    if (candidate.ends_on >= cycle.starts_on) continue;
    if (!previous || candidate.ends_on > previous.ends_on) previous = candidate;
  }
  return previous;
}

function formatDay(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/**
 * "12 Jan 2026 – 3 Apr 2026". Computed server-side and passed down as a
 * string: relative and locale formatting in a client component would disagree
 * with the SSR output (the rule display-format.ts states).
 */
export function describeCycleWindow(cycle: Pick<OutreachCycle, "starts_on" | "ends_on">): string {
  return `${formatDay(cycle.starts_on)} – ${formatDay(cycle.ends_on)}`;
}
