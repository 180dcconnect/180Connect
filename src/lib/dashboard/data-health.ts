/**
 * The dashboard's "Data health" card, decided: how much the branch holds, what
 * in it needs a person, and how each import source last went.
 *
 * Pure and tested by `node --test`; the page and `health-reads.ts` do the
 * reads. Run sentences come from the import-runs page's own formatter, so the
 * dashboard and `/admin/import-status` never describe one run two ways.
 *
 * Only possible duplicates and failed imports raise a warning. A client with no
 * website is a fact about the register, not a fault — most small charities
 * have none — so those counts are shown and left quiet.
 */
import { formatRelativeTime } from "../display-format.ts";
import {
  formatSource,
  summariseRun,
  type IngestionRunRow,
  // Relative, not `@/app/...`: node --test does not resolve the path alias.
} from "../../app/(app)/admin/import-status/run-format.ts";
import {
  isStalledRun,
  stalledRunSummary,
} from "../../app/(app)/admin/import-status/status-helpers.ts";
import type { HealthTone } from "./system-health.ts";

/** What "recently added" means on the card. */
export const RECENTLY_ADDED_DAYS = 7;

export type DataHealthFigure = {
  key: string;
  label: string;
  /** Null when the count could not be read. */
  value: number | null;
  tone: HealthTone;
  href?: string;
};

export type ImportSourceHealth = {
  raw: string;
  source: string;
  tone: HealthTone;
  /** "Last run 2 hours ago", or what went wrong. */
  note: string;
};

export type DataHealthInput = {
  now: Date;
  organisations: number | null;
  contacts: number | null;
  addedRecently: number | null;
  duplicates: number | null;
  enrichmentReview: number | null;
  missingWebsite: number | null;
  missingEmail: number | null;
  /** Newest first. Null when the runs could not be read. */
  runs: readonly IngestionRunRow[] | null;
};

export type DataHealthSummary = {
  totals: DataHealthFigure[];
  checks: DataHealthFigure[];
  sources: ImportSourceHealth[] | null;
  /** One plain sentence per thing that needs a person. Empty when nothing does. */
  warnings: string[];
  /** Whether any figure is missing, so the card can say so once. */
  incomplete: boolean;
};

/** Records created in the last `days` days. Rows with an unreadable date are skipped. */
export function countCreatedSince(
  rows: readonly { created_at: string }[],
  now: Date,
  days: number = RECENTLY_ADDED_DAYS,
): number {
  const since = now.getTime() - days * 24 * 60 * 60 * 1000;
  let count = 0;
  for (const row of rows) {
    const at = Date.parse(row.created_at);
    if (!Number.isNaN(at) && at >= since) count += 1;
  }
  return count;
}

const plural = (n: number, one: string, many: string) =>
  `${n.toLocaleString()} ${n === 1 ? one : many}`;

function latestPerSource(runs: readonly IngestionRunRow[], now: Date): ImportSourceHealth[] {
  const seen = new Map<string, ImportSourceHealth>();
  for (const run of runs) {
    if (seen.has(run.api_source)) continue;
    const when = formatRelativeTime(new Date(run.started_at), now).toLowerCase();
    const problem = run.job_status === "failed" || run.job_status === "partial";
    const stalled = run.job_status === "running" && isStalledRun(run.started_at, now);
    seen.set(run.api_source, {
      raw: run.api_source,
      source: formatSource(run.api_source),
      tone: problem ? "attention" : run.job_status === "running" ? "idle" : "ok",
      note: problem
        ? `${summariseRun(run, now)} (${when})`
        : run.job_status === "running"
          ? stalled
            ? stalledRunSummary(run.started_at, now)
            : "Running now"
          : `Last run ${when}`,
    });
  }
  return [...seen.values()];
}

export function summariseDataHealth(input: DataHealthInput): DataHealthSummary {
  const totals: DataHealthFigure[] = [
    { key: "organisations", label: "Organisations", value: input.organisations, tone: "idle" },
    { key: "contacts", label: "Contacts", value: input.contacts, tone: "idle" },
  ];

  const checks: DataHealthFigure[] = [
    {
      key: "added",
      label: `Added in the last ${RECENTLY_ADDED_DAYS} days`,
      value: input.addedRecently,
      tone: "idle",
    },
    {
      key: "duplicates",
      label: "Possible duplicates to review",
      value: input.duplicates,
      tone: input.duplicates ? "attention" : "idle",
      href: "/admin/duplicates",
    },
    {
      key: "enrichment",
      label: "Automatically found details to check",
      value: input.enrichmentReview,
      tone: "idle",
    },
    { key: "no-website", label: "Clients with no website", value: input.missingWebsite, tone: "idle" },
    { key: "no-email", label: "Clients with no contact email", value: input.missingEmail, tone: "idle" },
  ];

  const sources = input.runs ? latestPerSource(input.runs, input.now) : null;

  const warnings: string[] = [];
  if (input.duplicates) {
    warnings.push(
      `${plural(input.duplicates, "imported record may be", "imported records may be")} a client we already have. An admin decides whether to merge.`,
    );
  }
  for (const source of sources ?? []) {
    if (source.tone === "attention") warnings.push(`${source.source}: ${source.note}.`);
  }

  return {
    totals,
    checks,
    sources,
    warnings,
    incomplete: [...totals, ...checks].some((figure) => figure.value === null),
  };
}
