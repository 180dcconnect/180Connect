import { todayIso } from "../../../lib/date-range.ts";

/**
 * Validates a strict UTC ISO day string (`YYYY-MM-DD`).
 * Rejects invalid leap years, out-of-bounds months, or non-numeric tokens.
 */
export function isValidIsoDate(str: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) return false;
  const [year, month, day] = str.split("-").map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const d = new Date(Date.UTC(year, month - 1, day));
  return (
    d.getUTCFullYear() === year &&
    d.getUTCMonth() === month - 1 &&
    d.getUTCDate() === day
  );
}

/** Formats an ISO day string into en-GB format (e.g. "12 May 2024"). */
export function formatRegistrationDate(iso: string | null | undefined): string {
  if (!iso || !isValidIsoDate(iso)) return "";
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Formats a range of dates for trigger readout. */
export function formatRegistrationRange(
  from: string | null | undefined,
  to: string | null | undefined,
): string {
  const formattedFrom = formatRegistrationDate(from);
  const formattedTo = formatRegistrationDate(to);

  if (formattedFrom && formattedTo) {
    return `${formattedFrom} – ${formattedTo}`;
  }
  if (formattedFrom) {
    return `From ${formattedFrom}`;
  }
  if (formattedTo) {
    return `Up to ${formattedTo}`;
  }
  return "All registration dates";
}

export type RegistrationPreset = {
  label: string;
  from: string | null;
  to: string | null;
};

/** Quick presets tailored for charity registration searches. */
export function getRegistrationPresets(now: Date = new Date()): RegistrationPreset[] {
  const today = todayIso(now);
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const day = String(now.getUTCDate()).padStart(2, "0");

  const nYearsAgo = (n: number) => `${year - n}-${month}-${day}`;

  return [
    { label: "Past 12m", from: nYearsAgo(1), to: today },
    { label: "Past 3y", from: nYearsAgo(3), to: today },
    { label: "Past 5y", from: nYearsAgo(5), to: today },
    { label: "Since 2020", from: "2020-01-01", to: today },
    { label: "Pre-2015", from: null, to: "2014-12-31" },
  ];
}
