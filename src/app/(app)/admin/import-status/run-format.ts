/**
 * Turns an `ingestion_runs` row into something a person can read.
 *
 * The old page put eight numeric columns and a snake_case source name in a
 * table and left the reader to work out what had happened. The numbers are the
 * same; what changes here is that each run states its outcome in a sentence
 * first, and the counts are support for it rather than the whole message.
 *
 * Pure and node-testable, same split as `src/lib/audit-log-format.ts` — and it
 * borrows that page's time helpers rather than restating them, so a run and an
 * audit entry never disagree about what "2 hours ago" means.
 */

import {
  dayKeyOf,
  formatDayLabel,
  formatDuration,
  formatExactTime,
  formatRelativeTime,
  humaniseToken,
  // Relative, not `@/lib/...`: node --test strips types but does not resolve the
  // tsconfig path alias, and this module is tested directly.
} from "../../../../lib/display-format.ts";
import { describeImportFailure } from "../../../../lib/import-failure-reason.ts";
import { labelForStatus, runDisplayStatus, stalledRunSummary } from "./status-helpers.ts";

/**
 * The six sources in `public.data_source_name`, plus `charity_commission` from
 * `DATA_SOURCES` in `src/lib/ingestion/type.ts`. A source with no entry falls
 * back to its humanised token, so adding a seventh to the domain shows up here
 * spelled tolerably on the day it first runs.
 */
const SOURCE_LABELS: Record<string, string> = {
  charitybase: "CharityBase",
  charity_commission: "Charity Commission",
  // The two Charity Commission pipelines are separate sources (they carry
  // different payload shapes and dedup independently), so they need separate
  // labels — "Charity Commission Bulk" from the humanised token reads as a
  // spelling variant of the other rather than a different job.
  charity_commission_bulk: "Charity Commission (bulk register)",
  companies_house: "Companies House",
  "360giving": "360Giving",
  find_that_charity: "Find That Charity",
  globalgiving: "GlobalGiving",
  candid: "Candid",
};

export function formatSource(source: string): string {
  return SOURCE_LABELS[source] ?? humaniseToken(source);
}

/**
 * Which of the badge's four colours a run's chrome takes. Deliberately the same
 * four keys `status-helpers.ts` styles, because the badge is the thing on this
 * page people already read the status from — the icon disc and the counts just
 * agree with it.
 */
export type RunTone = "success" | "warning" | "danger" | "info" | "neutral";

const TONES: Record<string, RunTone> = {
  completed: "success",
  partial: "warning",
  failed: "danger",
  running: "info",
  stalled: "warning",
};

export function toneForStatus(status: string): RunTone {
  return TONES[status] ?? "neutral";
}

export type HumanisedError = {
  summary: string;
  description: string;
  actionHint?: string;
  rawMessage: string;
};

/**
 * Translates cryptic or technical error messages into clear, human-friendly
 * language with actionable instructions on where to configure settings.
 */
export function humaniseErrorMessage(errorMessage: string | null): HumanisedError | null {
  if (!errorMessage || !errorMessage.trim()) return null;
  const raw = errorMessage.trim();

  // Some runs created before the ingestion runner learned to read `.message`
  // from PostgREST errors persisted this JavaScript placeholder. It tells an
  // admin nothing, so history needs to say what can be done with that run.
  if (/^\[object Object\]$/i.test(raw)) {
    return {
      summary: "The import stopped without a readable reason",
      description:
        "This older import did not save a useful failure reason. Try the import again; if it stops again, ask a developer to check the import logs.",
      rawMessage: raw,
    };
  }

  // Companies House API key missing
  if (
    /COMPANIES_HOUSE_API_KEY/i.test(raw) ||
    /companies house.*api key.*not (set|configured)/i.test(raw)
  ) {
    return {
      summary: "Companies House API access key is not set",
      description:
        "The server requires a Companies House API key to connect to the official UK company register.",
      actionHint:
        "An administrator can configure this by setting the `COMPANIES_HOUSE_API_KEY` variable in your deployment environment settings (e.g. Vercel or .env.local).",
      rawMessage: raw,
    };
  }

  // Charity Commission API key missing
  if (
    /CHARITY_COMMISSION_API_KEY/i.test(raw) ||
    /charity commission.*api key.*not (set|configured)/i.test(raw)
  ) {
    return {
      summary: "Charity Commission API subscription key is not set",
      description:
        "The server requires a Charity Commission primary API key to fetch live register records.",
      actionHint:
        "An administrator can configure this by setting the `CHARITY_COMMISSION_API_KEY` variable in your deployment environment settings.",
      rawMessage: raw,
    };
  }

  // 401 / 403 / Invalid key
  if (/401|403|unauthorized|forbidden|invalid api key/i.test(raw)) {
    return {
      summary: "Authentication rejected by the data provider",
      description:
        "The external registry API rejected the request because the configured API key is invalid or lacks required permissions.",
      actionHint:
        "Verify that your configured API key in environment variables matches the key generated in your provider developer portal.",
      rawMessage: raw,
    };
  }

  // 429 / Rate limit
  if (/429|rate limit|too many requests/i.test(raw)) {
    return {
      summary: "Rate limit reached on external registry",
      description:
        "The external data source received too many requests in a short time window and temporarily paused responses.",
      actionHint:
        "No manual action needed. The job will automatically back off and retry during the next scheduled cycle.",
      rawMessage: raw,
    };
  }

  // Network / timeout
  if (/ETIMEDOUT|ECONNREFUSED|ENOTFOUND|fetch failed|timeout/i.test(raw)) {
    return {
      summary: "Connection timed out with registry service",
      description:
        "The server could not reach the external registry endpoint. The external service may be temporarily unavailable or down for maintenance.",
      actionHint: "Check the provider service status or retry the import in a few minutes.",
      rawMessage: raw,
    };
  }

  return {
    summary: raw.length > 90 ? `${raw.slice(0, 87)}…` : raw,
    description: raw,
    rawMessage: raw,
  };
}

export type IngestionRunRow = {
  id: string;
  api_source: string;
  job_status: "running" | "completed" | "failed" | "partial";
  records_fetched: number;
  records_inserted: number;
  records_skipped: number;
  records_failed: number;
  records_flagged: number;
  started_at: string;
  completed_at: string | null;
  error_message: string | null;
  triggered_by?: string | null;
  /**
   * The run's own breakdown, when the pipeline wrote one. Register imports
   * (Charity Commission bulk, Companies House bulk) stage register rows into
   * raw_source_records and then promote them into clients in the same run, so
   * `records_inserted` counts staged rows — not clients. When run_stats
   * carries the staging/promotion split, the summary and counts below read
   * from it instead of repeating the staging counter as "added".
   */
  run_stats?: Record<string, unknown> | null;
};

/** One count, ready to render. Zeroes are kept — "0 failed" is reassuring. */
export type RunCount = {
  label: string;
  value: number;
  tone: RunTone;
  /**
   * The record statuses this count is made of (`recordStatusKey` values on the
   * run detail page). A count that names them can be opened: the card becomes a
   * way into the records behind it, instead of a number the reader then has to
   * go and find by hand. Absent means the count has no records to show — a
   * skipped record was never staged, so there is nothing to open.
   */
  statusKeys?: string[];
};

export type RunView = {
  id: string;
  source: string;
  status: string;
  statusLabel: string;
  tone: RunTone;
  /** What happened, in one line. */
  summary: string;
  /** Every count, headline first — what the details panel and search read. */
  counts: RunCount[];
  /** The three a non-technical reader came for. See `describeRun`. */
  headline: RunCount[];
  /** The pipeline's own breakdown, for whoever opens the run. */
  details: RunCount[];
  /** The counts worth putting on a collapsed row: the ones that aren't zero. */
  highlights: RunCount[];
  errorMessage: string | null;
  humanError: HumanisedError | null;
  startedRelative: string;
  startedExact: string;
  finishedExact: string | null;
  duration: string;
  dayKey: string;
  dayLabel: string;
  triggeredBy?: string | null;
  triggerLabel?: string | null;
  /**
   * What the run was asked to import, in the words the person who started it
   * agreed to — or null for a run that predates the criteria being recorded,
   * and for every job that has no criteria to state (a backfill, a recheck).
   */
  criteriaSentence: string | null;
};

/**
 * The criteria a register import ran with, as the sentence the confirmation
 * dialog showed.
 *
 * Read defensively: `run_stats` is jsonb written by several different jobs,
 * and every run from before imports started recording this has counts and
 * nothing else. A run that cannot say what it looked for says nothing, rather
 * than inventing a description from its counts.
 */
export function runCriteriaSentence(run: IngestionRunRow): string | null {
  const stats = run.run_stats;
  if (!stats || typeof stats !== "object") return null;
  const sentence = (stats as Record<string, unknown>).criteriaSentence;
  return typeof sentence === "string" && sentence.trim() ? sentence.trim() : null;
}

const plural = (n: number, word: string) => `${n.toLocaleString()} ${word}${n === 1 ? "" : "s"}`;

/** Sources whose runs stage register rows before promoting them into clients. */
const REGISTER_IMPORT_SOURCES = new Set(["charity_commission_bulk", "companies_house"]);

function numericStat(stats: Record<string, unknown>, key: string): number | null {
  const value = stats[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Staging/promotion split for a register-import run, or null when the row
 * predates the breakdown (or is not a register import at all). Keyed off the
 * run_stats shape rather than the source alone: `companies_house` also labels
 * non-import runs, and only the register import writes `written`.
 */
export type RegisterImportBreakdown = {
  staged: number;
  clientsAdded: number | null;
  duplicates: number;
  needsReview: number;
  didNotMeet: number;
  notUsable: number;
  failedToSave: number;
  /**
   * Why the failures happened, as the promote step recorded them (raw database
   * text — `describeImportFailure` translates it). Empty for runs written
   * before the reasons were kept, which is why the page still has to cope with
   * a failure count and no reason.
   */
  failureReasons: string[];
};

function stringListStat(stats: Record<string, unknown>, key: string): string[] {
  const value = stats[key];
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string" && entry.trim() !== "");
}

export function registerImportBreakdown(run: IngestionRunRow): RegisterImportBreakdown | null {
  return registerImportBreakdownFrom(run.api_source, run.run_stats);
}

/**
 * The same reading from the two fields it actually needs, so the source pages
 * (`admin/charity-commission`, `admin/companies-house`) can describe a run the
 * way Import Status does without carrying the whole row shape. One reader means
 * the two screens cannot disagree about whether an import worked.
 */
export function registerImportBreakdownFrom(
  apiSource: string,
  runStats: Record<string, unknown> | null | undefined,
): RegisterImportBreakdown | null {
  if (!REGISTER_IMPORT_SOURCES.has(apiSource)) return null;
  const stats = runStats;
  if (!stats || typeof stats !== "object") return null;
  const staged = numericStat(stats, "written");
  if (staged === null) return null;
  return {
    staged,
    clientsAdded: numericStat(stats, "inserted"),
    duplicates: numericStat(stats, "flagged") ?? 0,
    needsReview: numericStat(stats, "needsReview") ?? 0,
    didNotMeet: numericStat(stats, "doesNotMeet") ?? 0,
    notUsable: numericStat(stats, "invalidData") ?? 0,
    failedToSave: numericStat(stats, "failed") ?? 0,
    failureReasons: stringListStat(stats, "failureReasons"),
  };
}

/**
 * The outcome as a sentence. Built from the counts rather than from the status
 * alone: two `completed` runs where one added ten thousand records and the other
 * added nothing are not the same event, and the status badge cannot tell them
 * apart.
 */
export function summariseRun(run: IngestionRunRow, now: Date = new Date()): string {
  const { records_fetched: fetched, records_inserted: inserted } = run;

  if (run.job_status === "running") {
    // A run interrupted mid-write holds frozen counts that would mislead, so
    // the stalled sentence carries no numbers — see `stalledRunSummary`.
    if (runDisplayStatus(run.job_status, run.started_at, now) === "stalled") {
      return stalledRunSummary(run.started_at, now);
    }
    return fetched > 0
      ? `Running now — ${plural(fetched, "record")} fetched so far`
      : "Running now — nothing fetched yet";
  }

  if (run.job_status === "failed") {
    return fetched > 0
      ? `Failed after fetching ${plural(fetched, "record")}`
      : "Failed before fetching anything";
  }

  if (fetched === 0) return "Nothing to fetch — the source returned no records";

  // Register imports copy register rows into a holding table and then add them
  // to the client list. The holding table is an implementation step, not an
  // outcome, so it does not appear in the sentence at all — a run that "staged
  // 311" while adding nobody is the shape that read as a success for a year.
  const register = registerImportBreakdown(run);
  if (register) {
    if (register.clientsAdded === null) {
      // Promotion never ran, so no outcome can be claimed. Say only what is
      // known, in the words of the job.
      const held = `${plural(register.staged, "record")} from the source are waiting to be added`;
      return run.job_status === "partial" ? `${held} — the run did not finish cleanly` : held;
    }

    // A run that refused records is not a list of counts with one unlucky
    // number in it — it is a failure, and the sentence leads with that. The
    // reason comes from the run's own record of why the saves were refused, so
    // the reader is told what went wrong instead of being sent to find a
    // developer with nothing to hand them.
    if (register.failedToSave > 0) {
      const count = register.failedToSave.toLocaleString();
      const noun = register.failedToSave === 1 ? "record" : "records";
      const head =
        register.clientsAdded === 0
          ? `Nothing was added to the client list — all ${count} ${noun} were refused`
          : `${register.clientsAdded.toLocaleString()} added to the client list, ${count} ${noun} refused`;
      const reason = describeImportFailure(register.failureReasons[0] ?? null);
      return reason ? `${head}. ${reason.summary}.` : `${head}.`;
    }

    const head =
      register.clientsAdded === 0
        ? `Nothing new to add from ${plural(fetched, "record")} in the source`
        : `${register.clientsAdded.toLocaleString()} added to the client list from ` +
          `${plural(fetched, "record")} in the source`;

    const parts = [head];

    // Adding is not scoped to one run: it works through everything waiting,
    // including records earlier runs left behind. Nearly always that backlog is
    // empty and the two numbers agree — but on the run that drains one, "821
    // added from 98 records" is two different populations in one sentence, so
    // the sentence has to say so. Approximate by construction (some of this
    // run's own rows may have been duplicates), hence "about".
    const backlog = register.clientsAdded - register.staged;
    if (backlog > 0) {
      parts.push(
        `about ${backlog.toLocaleString()} of them had been waiting from earlier imports`,
      );
    }

    const needsLook = register.needsReview + register.duplicates + register.notUsable;
    if (needsLook > 0) parts.push(`${needsLook.toLocaleString()} need a look`);
    if (register.didNotMeet > 0) {
      parts.push(`${register.didNotMeet.toLocaleString()} did not fit the client criteria`);
    }
    if (run.records_skipped > 0) {
      parts.push(`${run.records_skipped.toLocaleString()} already on the list`);
    }

    const summary = parts.join(", ");
    return run.job_status === "partial" ? `${summary} — the run did not finish cleanly` : summary;
  }

  const added =
    inserted === 0
      ? `Added nothing new from ${plural(fetched, "record")}`
      : `Added ${inserted.toLocaleString()} of ${plural(fetched, "record")}`;

  // `partial` is the status for a run that hit a source's paging ceiling or lost
  // some records on the way, so the sentence has to say the number is not the
  // whole story — otherwise it reads as a clean success with a yellow badge.
  return run.job_status === "partial" ? `${added} — the run did not finish cleanly` : added;
}

export function describeRun(run: IngestionRunRow, now: Date): RunView {
  const started = new Date(run.started_at);
  const finished = run.completed_at ? new Date(run.completed_at) : null;
  const register = registerImportBreakdown(run);

  // Two ways a run can have gone wrong, one panel to explain either: the run
  // itself stopped (`error_message`), or it finished but the client list
  // refused what it tried to save (`run_stats.failureReasons`). The second used
  // to render nothing at all — the row showed a failure count and no reason,
  // which is how an import that added zero clients could still look fine.
  const promoteFailure =
    register && register.failedToSave > 0
      ? describeImportFailure(register.failureReasons[0] ?? null)
      : null;
  const humanError: HumanisedError | null =
    humaniseErrorMessage(run.error_message) ??
    (promoteFailure
      ? {
          summary: promoteFailure.summary,
          description: promoteFailure.description,
          actionHint: promoteFailure.actionHint,
          rawMessage: promoteFailure.rawMessage,
        }
      : register && register.failedToSave > 0
        ? {
            // Runs from before the promote step kept its reasons. Saying so is
            // the honest answer; leaving the panel out entirely is what made
            // these look like ordinary runs with an odd number on them.
            summary: "The client list refused these records, and this run did not record why",
            description:
              "This import ran before the app started keeping the reason a record was refused, so the count is all it saved.",
            actionHint:
              "Run the import again — a repeat failure will say what went wrong. If it succeeds, nothing more is needed.",
            rawMessage: "",
          }
        : null);
  // ── Three numbers, then everything else ──
  //
  // The page used to headline eight: fetched, staged, added, skipped, failed,
  // flagged, needs review, did not meet criteria. Five of those name a stage of
  // the pipeline rather than an outcome, and one of them — staged — is a
  // holding table the reader cannot act on and should never have been asked to
  // reason about. A CAM or admin arrives with three questions: did clients get
  // added, how many were already here, and is anything waiting on me. So those
  // three lead, and the rest moves behind the details expander for whoever
  // wants it. Nothing is dropped; the ordering says what matters.
  const headline: RunCount[] = register
    ? [
        {
          label: "Added to the client list",
          value: register.clientsAdded ?? 0,
          tone: "success",
          statusKeys: ["validated"],
        },
        { label: "Already on the list", value: run.records_skipped, tone: "neutral" },
        {
          // Everything that stopped short of the client list and has somewhere
          // to be answered — one number, because a reader wants to know whether
          // anything is waiting on them, not how it is filed internally. Red,
          // not amber: this is the one count on the row that asks for something.
          label: "Needs a look",
          statusKeys: ["matched", "rejected_review", "error"],
          value:
            register.needsReview +
            register.duplicates +
            register.notUsable +
            register.failedToSave +
            run.records_failed +
            run.records_flagged,
          tone: "danger",
        },
      ]
    : [
        {
          label: "Added to the client list",
          value: run.records_inserted,
          tone: "success",
          statusKeys: ["validated"],
        },
        { label: "Already on the list", value: run.records_skipped, tone: "neutral" },
        {
          label: "Needs a look",
          value: run.records_failed + run.records_flagged,
          tone: "danger",
          statusKeys: ["matched", "rejected_review", "error"],
        },
      ];

  const details: RunCount[] = register
    ? [
        { label: "From the source", value: run.records_fetched, tone: "neutral" },
        {
          label: "Held for review",
          value: register.needsReview,
          tone: "info",
          statusKeys: ["rejected_review"],
        },
        {
          label: "Possible duplicates",
          value: register.duplicates + run.records_flagged,
          tone: "warning",
          statusKeys: ["matched"],
        },
        {
          label: "Did not fit the criteria",
          value: register.didNotMeet,
          tone: "neutral",
          statusKeys: ["rejected"],
        },
        {
          label: "Could not be saved",
          value: register.notUsable + register.failedToSave + run.records_failed,
          tone: "danger",
          statusKeys: ["error"],
        },
      ]
    : [
        { label: "From the source", value: run.records_fetched, tone: "neutral" },
        {
          label: "Possible duplicates",
          value: run.records_flagged,
          tone: "warning",
          statusKeys: ["matched"],
        },
        {
          label: "Could not be saved",
          value: run.records_failed,
          tone: "danger",
          statusKeys: ["error"],
        },
      ];

  // `counts` stays the whole picture, headline first, because the details panel
  // and the free-text search both read it.
  const counts: RunCount[] = [...headline, ...details];

  const triggeredBy = run.triggered_by ?? null;
  const triggerLabel =
    triggeredBy === "manual" ? "Manual" : triggeredBy === "schedule" ? "Scheduled" : null;

  // Display-only: a run the database still calls `running` reads as `stalled`
  // past the threshold, and the badge, tone and sentence all follow that one
  // answer. The stored row is untouched.
  let status = runDisplayStatus(run.job_status, run.started_at, now);

  // Display-only again, for the same reason: a run that staged rows and then
  // had every one of them refused was stored as `completed`, so the page put a
  // green badge over an import that added nothing. The stored row is left
  // alone; what the reader is shown matches what the run actually achieved.
  if (status === "completed" && register && register.failedToSave > 0) {
    status = register.clientsAdded === 0 || register.clientsAdded === null ? "failed" : "partial";
  }

  return {
    id: run.id,
    source: formatSource(run.api_source),
    status,
    statusLabel: labelForStatus(status),
    tone: toneForStatus(status),
    summary: summariseRun(run, now),
    counts,
    headline,
    details,
    // The collapsed row carries only what happened, and only from the three
    // that lead. A row of counts where most are zero is furniture around one
    // fact.
    highlights: headline.filter((count) => count.value > 0),
    errorMessage: run.error_message,
    humanError,
    startedRelative: formatRelativeTime(started, now),
    startedExact: formatExactTime(started),
    finishedExact: finished ? formatExactTime(finished) : null,
    // A run still going has no duration yet, and guessing one from `now` would
    // show a number that changes every refresh for a reason nothing explains.
    duration: finished ? formatDuration(finished.getTime() - started.getTime()) : "—",
    dayKey: dayKeyOf(started),
    dayLabel: formatDayLabel(started, now),
    triggeredBy,
    triggerLabel,
    criteriaSentence: runCriteriaSentence(run),
  };
}

/** Free-text search over what the reader can see, same contract as the audit log. */
export function matchesRunQuery(view: RunView, query: string): boolean {
  const term = query.trim().toLowerCase();
  if (!term) return true;

  const monthName = (() => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(view.dayKey)) {
      const [y, m, d] = view.dayKey.split("-").map(Number);
      return new Date(y, m - 1, d).toLocaleDateString("en-GB", { month: "long" });
    }
    return "";
  })();

  const haystack = [
    view.source,
    view.statusLabel,
    view.status,
    view.summary,
    view.errorMessage ?? "",
    view.humanError?.summary ?? "",
    view.humanError?.description ?? "",
    view.humanError?.actionHint ?? "",
    view.dayLabel,
    view.dayKey,
    view.startedExact,
    view.startedRelative,
    monthName,
    view.triggerLabel ?? "",
  ]
    .join(" ")
    .toLowerCase();
  return term.split(/\s+/).every((word) => haystack.includes(word));
}
