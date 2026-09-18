/**
 * The clock strip on the public 404 page: the places the team works from, and
 * the time it currently is in each of them.
 *
 * Pure and framework-free so it can be tested — the page imports it and never
 * formats a date inline (the pattern `src/lib/audit-log-format.ts` sets).
 *
 * Two things here are easier to get wrong than they look:
 *
 * 1. **A zone id, never an offset.** Sheffield shifts to BST and back, and
 *    Sydney shifts too — but in the opposite direction and on different dates.
 *    A hard-coded `+1` is wrong for half the year, and wrong for Sydney for
 *    more than half of it. `Intl` with an IANA zone moves with the rules.
 * 2. **Abuja is `Africa/Lagos`.** There is no `Africa/Abuja`, and an invented
 *    id does not throw at build time — it throws in the browser, where the
 *    clock would sit blank. `local-time.test.ts` resolves every zone here for
 *    that reason.
 *
 * The hour is 12-hour with an am/pm marker, split into two pieces rather than
 * handed back as one string so the page can set the marker in small muted type
 * — the strip reads as a clock, not as a label ending in a shout.
 */

export type OfficeClock = {
  /** The city the team sits in — what a reader recognises, not a zone id. */
  city: string;
  country: string;
  /** An IANA time zone id, e.g. `Europe/London`. */
  timeZone: string;
};

/**
 * Ordered west to east, so the strip reads as one sweep of the globe: the two
 * on UTC+1 are the same hour almost all year, and Sydney is the far end of the
 * team's day.
 */
export const OFFICE_CLOCKS: readonly OfficeClock[] = [
  { city: "Sheffield", country: "England", timeZone: "Europe/London" },
  { city: "Abuja", country: "Nigeria", timeZone: "Africa/Lagos" },
  { city: "Sydney", country: "Australia", timeZone: "Australia/Sydney" },
];

/**
 * Formatters are not cheap to construct and this runs on a timer, so one per
 * zone is built once and kept. The map is module scope rather than a component
 * ref because the zones are constants — there is nothing per-instance to key on.
 */
const formatters = new Map<string, Intl.DateTimeFormat>();

export type OfficeTime = {
  /** The reading, no marker and no leading zero: `1:00`, `12:07`. */
  time: string;
  /** `am` or `pm`, lower case. */
  period: string;
};

/**
 * The time of day it is in `timeZone`, as a reading and its am/pm marker.
 *
 * `hourCycle: "h12"` does the one thing that is easy to get wrong here: after
 * midnight it reads `12:07 am`, and at midday `12:05 pm`. Neither is ever `0`,
 * and neither borrows the other's marker — the mistakes a hand-rolled
 * `% 12` makes, at the two times of day a reader is most likely to check.
 *
 * `hour: "numeric"` (not `"2-digit"`) because the marker alongside it is
 * already anchoring which end of the clock this is; `01:00 pm` is a
 * train-timetable reading, and the strip is not a timetable.
 *
 * `en-GB` rather than the visitor's locale: the strip is a fixed set of numbers
 * in a fixed layout, and a locale that reads `13.00` or `1:04 PM` would either
 * break the column the markup's `tabular-nums` holds open or change the
 * marker's weight on the page. The marker is lower-cased here rather than left
 * to the locale so the styling in the page can rely on it.
 *
 * Read through `formatToParts` rather than `format`: the two halves have to be
 * separable to be styled separately, and the literal ICU puts between them is a
 * plain space in one locale and a narrow no-break space in another — joining
 * the parts ourselves means no invisible character ends up in a test.
 */
export function officeTimeIn(date: Date, timeZone: string): OfficeTime {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour: "numeric",
      minute: "2-digit",
      hourCycle: "h12",
    });
    formatters.set(timeZone, formatter);
  }

  const parts = formatter.formatToParts(date);

  // A missing part means the runtime declined to format one, which is a broken
  // clock rather than an exception — render the dashes and carry on.
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value;

  return {
    time: `${part("hour") ?? "--"}:${part("minute") ?? "--"}`,
    period: part("dayPeriod")?.toLowerCase() ?? "",
  };
}
