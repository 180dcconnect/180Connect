/**
 * The dashboard's "System health" card, decided.
 *
 * Admins and leadership are not engineers, so the card is three short lists in
 * the words of the job — "Reply sync: ran 3 minutes ago" — and it only raises
 * its voice when something needs a person. Everything here is pure and tested
 * by `node --test`; `health-reads.ts` does the reads.
 *
 * Honesty rules, because a green tick nobody earned is worse than no tick:
 *
 * - **Nothing is "operational" unless something proved it.** Errors go to
 *   Sentry and the platform logs, not a table, so the app cannot see whether an
 *   AI call failed. An AI row therefore says when the feature last *worked*
 *   (its newest saved generation), never that it is up.
 * - **"Connected" means the app holds what the service needs, not that the far
 *   end answered.** Only Gmail gets a live round trip
 *   (`getOutreachEngineHealth`); Gemini, Companies House and Charity Commission
 *   report connected on the strength of their key alone.
 * - **The words name a state, never a to-do.** These rows used to say "Set up"
 *   and "Not set up", which admins read as an instruction — "does this mean I
 *   should set it up?". Whether a key is present is decided outside the app and
 *   nobody reading this card can change it, so the state is called what it is.
 *   Not connected stays quiet rather than a warning: staging has no Gmail and no
 *   API keys by design, and a card that is red on every staging load teaches
 *   people to ignore red.
 */
import { formatCadence, formatRelativeTime } from "../display-format.ts";

/** `ok` is a proven reading, `attention` needs a person, `idle` is neither. */
export type HealthTone = "ok" | "attention" | "idle";

export type HealthRow = {
  key: string;
  label: string;
  tone: HealthTone;
  /** Short, plain: "Ran 3 minutes ago", "Last run failed 2 hours ago". */
  note: string;
};

export type HealthGroup = {
  title: string;
  /** Null when the group's own read failed — `unavailable` says so instead. */
  rows: HealthRow[] | null;
  unavailable?: string;
};

export type CronJobRow = {
  job_name: string;
  last_run_at: string | null;
  last_run_succeeded: boolean | null;
};

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * One line on the card per thing an admin would recognise, backed by the
 * pg_cron job(s) that do it. Housekeeping jobs (log and notification pruning,
 * the 30-second reply nudge that sits beside the five-minute sweep) are left
 * off: nobody can act on them, and every extra row makes the real ones harder
 * to see. A job that has been retired comes off this list too, in the same
 * change that unschedules it — a task whose job no longer exists reports "Not
 * scheduled here" on every environment, for ever, which is noise dressed up as
 * a reading.
 *
 * `everyMs` is the job's schedule, taken from its migration. A job counts as
 * stalled once it has missed two runs, plus a little slack for a slow tick —
 * and only while the rest of the schedule is still ticking, so a sleeping
 * platform is never mistaken for a broken job (see
 * `restOfScheduleRanSince`).
 */
export type ScheduledTask = {
  key: string;
  label: string;
  jobs: readonly string[];
  everyMs: number;
};

export const SCHEDULED_TASKS: readonly ScheduledTask[] = [
  { key: "reply-sync", label: "Reply sync", jobs: ["gmail_reply_sync"], everyMs: 5 * MINUTE },
  {
    key: "scheduled-send",
    label: "Scheduled sending",
    jobs: ["scheduled_outreach_delivery"],
    everyMs: 5 * MINUTE,
  },
  {
    key: "grants",
    label: "360Giving grants",
    jobs: ["three_sixty_giving_backfill"],
    everyMs: 15 * MINUTE,
  },
  {
    key: "follow-up-checks",
    label: "Stalled and no-reply checks",
    jobs: ["stall_detection_daily", "no_response_sweep_daily"],
    everyMs: DAY,
  },
  {
    key: "reminders",
    label: "Reminders and digests",
    jobs: ["reminder_notifications_daily", "team_activity_digest_hourly"],
    everyMs: DAY,
  },
  {
    key: "financials",
    label: "Financials refresh",
    jobs: ["charity_commission_financial_refresh_weekly"],
    everyMs: 7 * DAY,
  },
];

// Deliberately not a row: weekly register discovery. No charities and companies
// used to be its own line here, driven by `charity_commission_discovery_weekly`
// and `companies_house_discovery_weekly` — but both jobs were unscheduled when
// the register files replaced API discovery (20260923120000 and
// 20260923132000), so the row could only ever say "Not scheduled here" on every
// environment, forever. New charities and companies now arrive through the
// imports on /admin/charity-commission and /admin/companies-house, which is a
// person pressing a button, not a schedule — nothing here can time it, so the
// card stays quiet about it rather than advertising a job nobody runs.

/** Every job name the card asks `get_outreach_cron_health` about. */
export const SCHEDULED_JOB_NAMES: readonly string[] = SCHEDULED_TASKS.flatMap((task) => task.jobs);

/**
 * Links out to the providers' own status pages, rendered as the card's
 * "Provider status" group (see `SystemHealthCard`).
 *
 * Deliberately links, never live readings: a status that depended on the
 * database or on a fetch from the provider could not report when that same
 * dependency is down — exactly when it is needed. The makers' pages keep
 * working when this app does not, and there is nothing here for anyone to
 * maintain: no fetch, no cron, no new row against the database budget.
 *
 * Labels say what each provider runs in the words of the job, so an admin who
 * is not an engineer can tell which link matches what they see broken.
 */
export type ProviderStatusLink = {
  key: string;
  label: string;
  href: string;
};

export const PROVIDER_STATUS_LINKS: readonly ProviderStatusLink[] = [
  {
    key: "supabase",
    label: "Supabase — holds the data and handles login",
    href: "https://status.supabase.com/",
  },
  {
    key: "vercel",
    label: "Vercel — serves the app",
    href: "https://www.vercel-status.com/",
  },
  {
    key: "google-workspace",
    label: "Google Workspace — sends and receives email",
    href: "https://www.google.com/appsstatus/dashboard/",
  },
];

const STALL_SLACK_MS = 10 * MINUTE;

/**
 * Whether the schedule is provably ticking, judged only by jobs other than this
 * task's own.
 *
 * This is the whole difference between "reply sync has not run for two hours"
 * and "reply sync has not run for two hours *while everything else kept
 * running*". On the free plan the database sleeps between visits and pg_cron
 * cannot tick while it does, so a page load is often the very thing that wakes
 * it: every job comes back hours stale together, and the overdue runs fire
 * seconds later. Flagging that would put a red banner on the dashboard every
 * morning for a system that is working — and a card that is red when nothing is
 * wrong is a card nobody reads.
 *
 * So a task is never flagged on age alone. It is flagged when another job on
 * the schedule has reported since this task last did — the platform has been
 * awake and this one still has not come back. A read with nothing else on the
 * schedule proves neither way and stays quiet; the row still says how long ago
 * it ran, so the reading is kept even when the alarm is withheld.
 */
function restOfScheduleRanSince(
  rows: readonly CronJobRow[],
  task: ScheduledTask,
  since: string,
): boolean {
  const sinceMs = new Date(since).getTime();
  if (Number.isNaN(sinceMs)) return false;
  return rows.some(
    (row) =>
      !task.jobs.includes(row.job_name) &&
      row.last_run_at !== null &&
      new Date(row.last_run_at).getTime() > sinceMs,
  );
}

/**
 * One task's row. Worst job wins: a failed run, then a stalled job, then the
 * newest successful run.
 *
 * Several of these jobs only hand a request to a Vercel route (`net.http_post`),
 * and pg_cron records that hand-off, not what the route then did. So "Ran 5
 * minutes ago" means the schedule is ticking; a route that fails on every tick
 * reports through Sentry, not here.
 */
export function scheduledTaskRow(
  task: ScheduledTask,
  rows: readonly CronJobRow[],
  now: Date,
): HealthRow {
  const base = { key: task.key, label: task.label };
  const jobs = task.jobs
    .map((name) => rows.find((row) => row.job_name === name))
    .filter((row): row is CronJobRow => row !== undefined);

  if (jobs.length === 0) return { ...base, tone: "idle", note: "Not scheduled here" };

  const relative = (at: string) => formatRelativeTime(new Date(at), now).toLowerCase();

  const failed = jobs.find((job) => job.last_run_at && job.last_run_succeeded === false);
  if (failed?.last_run_at) {
    return { ...base, tone: "attention", note: `Last run failed ${relative(failed.last_run_at)}` };
  }

  const ran = jobs.filter((job): job is CronJobRow & { last_run_at: string } => !!job.last_run_at);
  if (ran.length === 0) {
    return { ...base, tone: "idle", note: `Waiting for its first run — runs ${formatCadence(task.everyMs)}` };
  }

  const behind = ran.find(
    (job) => now.getTime() - new Date(job.last_run_at).getTime() > task.everyMs * 2 + STALL_SLACK_MS,
  );
  if (behind && restOfScheduleRanSince(rows, task, behind.last_run_at)) {
    return {
      ...base,
      tone: "attention",
      note: `Has not run since ${relative(behind.last_run_at)}`,
    };
  }

  const newest = ran.reduce((a, b) => (new Date(b.last_run_at) > new Date(a.last_run_at) ? b : a));
  return { ...base, tone: "ok", note: `Ran ${relative(newest.last_run_at)}` };
}

/** A timestamp read that can fail on its own without taking the card down. */
export type LastUse = { ok: true; at: string | null } | { ok: false };

export type GmailReading = {
  status: "active" | "unconfigured" | "reauth-required" | "degraded";
  detail: string;
};

export type SystemHealthInput = {
  now: Date;
  keys: { ai: boolean; companiesHouse: boolean; charityCommission: boolean };
  /** Null when this viewer's dashboard did not run the Gmail check. */
  gmail: GmailReading | null;
  lastDraft: LastUse;
  lastBooklet: LastUse;
  lastScored: LastUse;
  /** Null when the schedule could not be read. */
  cronJobs: readonly CronJobRow[] | null;
};

export type SystemHealthSummary = {
  groups: HealthGroup[];
  /** Every row that needs a person, with the group it sits in. */
  attention: (HealthRow & { group: string })[];
};

function lastUseRow(
  key: string,
  label: string,
  use: LastUse,
  verb: string,
  empty: string,
  now: Date,
  keySet = true,
): HealthRow {
  if (!keySet) return { key, label, tone: "idle", note: "Not connected" };
  if (!use.ok) return { key, label, tone: "idle", note: "Could not check" };
  if (!use.at) return { key, label, tone: "ok", note: empty };
  return {
    key,
    label,
    tone: "ok",
    note: `${verb} ${formatRelativeTime(new Date(use.at), now).toLowerCase()}`,
  };
}

function keyRow(key: string, label: string, set: boolean): HealthRow {
  return set
    ? { key, label, tone: "ok", note: "Connected" }
    : { key, label, tone: "idle", note: "Not connected" };
}

function gmailRow(gmail: GmailReading | null): HealthRow {
  const base = { key: "gmail", label: "Gmail" };
  if (!gmail) return { ...base, tone: "idle", note: "Not checked" };
  if (gmail.status === "active") return { ...base, tone: "ok", note: "Connected" };
  if (gmail.status === "unconfigured") return { ...base, tone: "idle", note: "Not connected" };
  return { ...base, tone: "attention", note: gmail.detail };
}

export function summariseSystemHealth(input: SystemHealthInput): SystemHealthSummary {
  const { now } = input;

  const groups: HealthGroup[] = [
    {
      title: "AI and scoring",
      rows: [
        lastUseRow("drafting", "Email drafting", input.lastDraft, "Last draft", "No drafts yet", now, input.keys.ai),
        lastUseRow("booklets", "Client booklets", input.lastBooklet, "Last booklet", "No booklets yet", now, input.keys.ai),
        // SCOUT is a rules engine, not a model call: it needs no key.
        lastUseRow("scoring", "Priority scoring", input.lastScored, "Last scored", "No clients scored yet", now),
      ],
    },
    {
      title: "Connected services",
      rows: [
        gmailRow(input.gmail),
        keyRow("gemini", "Google Gemini", input.keys.ai),
        keyRow("companies-house", "Companies House", input.keys.companiesHouse),
        keyRow("charity-commission", "Charity Commission", input.keys.charityCommission),
      ],
    },
    input.cronJobs
      ? {
          title: "Scheduled jobs",
          rows: SCHEDULED_TASKS.map((task) => scheduledTaskRow(task, input.cronJobs ?? [], now)),
        }
      : {
          title: "Scheduled jobs",
          rows: null,
          unavailable: "The schedule could not be read just now — that is this check failing, not the jobs stopping. Refresh to try again.",
        },
  ];

  const attention = groups.flatMap((group) =>
    (group.rows ?? [])
      .filter((row) => row.tone === "attention")
      .map((row) => ({ ...row, group: group.title })),
  );

  return { groups, attention };
}
