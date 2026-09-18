import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { formatCadence, formatExactTime } from "../display-format.ts";
import {
  GmailAuthError,
  getGmailAccessToken,
  resolveGmailConfig,
  resolveGmailSender,
  type GmailConfig,
} from "./client.ts";

/**
 * Honest health of the outreach transport, for the inbox sidebar's status card.
 *
 * The card used to render a hardcoded "Outreach Engine Active" tick no matter
 * what — including on deployments with no Gmail credentials at all. Every
 * non-`active` value here renders an X instead of the tick, so the UI can only
 * claim Active when the server just proved it.
 */
export type GmailEngineStatus =
  | "active"
  | "unconfigured"
  | "reauth-required"
  | "degraded";

export type GmailEngineHealth = {
  status: GmailEngineStatus;
  /** Lower-cased branch mailbox, or null when GMAIL_SENDER_EMAIL is unset. */
  sender: string | null;
  /** Short human-readable reason. Safe to log — never carries credentials. */
  detail: string;
};

export type CronJobStatus = "active" | "degraded" | "unconfigured";

export type CronJobHealth = {
  status: CronJobStatus;
  detail: string;
};

export type OutreachEngineHealth = {
  transport: GmailEngineHealth;
  replySync: CronJobHealth;
  scheduledSend: CronJobHealth;
};

const GMAIL_REPLY_SYNC_JOB = "gmail_reply_sync";
const SCHEDULED_OUTREACH_DELIVERY_JOB = "scheduled_outreach_delivery";
/**
 * The 30-second inbox check (`20261003150000`), read only as proof the schedule
 * is alive. It is not a row on the card: when it works, it files a reply within
 * seconds and the five-minute sweep below is invisible to everyone, and when it
 * does not, the sweep is what actually matters. Its value here is that it ticks
 * 120 times more often than either card job, so "it has run since" is the
 * crispest answer to "is the scheduler awake?".
 */
const GMAIL_REPLY_CHECK_JOB = "gmail_reply_check";
/** The card's two jobs run every 5 minutes; only raise a stalled warning after
    an hour of silence (12 missed sweeps). Age alone is still not enough — see
    `siblingRanSince` — so the warning is left for the case that is really a
    break and not a platform that has just woken up. */
const CRON_STALE_AFTER_MS = 60 * 60 * 1000;

/**
 * What one scheduler row's tooltip says it is.
 *
 * The tooltip is the only place the card can explain itself, and a bare
 * timestamp explains nothing: "Last ran successfully at 10:05" leaves a CAM
 * without knowing what ran, or what it is supposed to have done for them. So
 * every detail opens with what the job does and closes with what it last
 * reported.
 */
type CronJobDescriptor = {
  /** Row label prefix, matching the sidebar's "Reply Sync Active" wording. */
  name: string;
  /** One clause, read straight after the name: "Reply sync checks ...". */
  purpose: string;
  /** The job's schedule, taken from its migration — the only honest answer to
      "when?" while no run has been recorded yet (pg_cron keeps past runs only). */
  everyMs: number;
};

const FIVE_MINUTES = 5 * 60 * 1000;

const REPLY_SYNC_JOB: CronJobDescriptor = {
  name: "Reply sync",
  purpose:
    "checks the branch mailbox every five minutes and files new replies into the inbox",
  everyMs: FIVE_MINUTES,
};

const SCHEDULED_SEND_JOB: CronJobDescriptor = {
  name: "Scheduled send",
  purpose: "sends queued outreach as soon as its scheduled time passes",
  everyMs: FIVE_MINUTES,
};

type CronHealthRow = {
  job_name: string;
  last_run_at: string | null;
  last_run_succeeded: boolean | null;
};

const PROFILE_ENDPOINT =
  "https://gmail.googleapis.com/gmail/v1/users/me/profile";
const PROFILE_TIMEOUT_MS = 8_000;
/** Hard cap so a sick Gmail can never hold the inbox page open. The OAuth
    exchange inside getGmailAccessToken has its own (longer) timeout, so this
    race — not the inner fetch — bounds the check. */
const CHECK_TIMEOUT_MS = 6_000;

function isCredentialRejection(status: number | null): boolean {
  return status === 400 || status === 401 || status === 403;
}

async function checkGmailTransport(
  config: GmailConfig,
  sender: string,
  fetchImpl: typeof fetch,
): Promise<GmailEngineHealth> {
  let token: string;
  try {
    token = await getGmailAccessToken(config, fetchImpl);
  } catch (error) {
    // getGmailAccessToken already logged and reported this; the check itself
    // stays quiet so every inbox load during an outage does not pile on.
    if (
      error instanceof GmailAuthError &&
      isCredentialRejection(error.status)
    ) {
      return {
        status: "reauth-required",
        sender,
        detail: "The Gmail connection needs to be re-authorised.",
      };
    }
    return {
      status: "degraded",
      sender,
      detail: "Gmail is temporarily unavailable.",
    };
  }

  try {
    const response = await fetchImpl(PROFILE_ENDPOINT, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(PROFILE_TIMEOUT_MS),
    });
    if (response.status === 401 || response.status === 403) {
      return {
        status: "reauth-required",
        sender,
        detail: "The Gmail connection needs to be re-authorised.",
      };
    }
    if (!response.ok) {
      return {
        status: "degraded",
        sender,
        detail: "Gmail is temporarily unavailable.",
      };
    }
    const body = (await response.json().catch(() => null)) as {
      emailAddress?: string;
    } | null;
    const profileEmail = body?.emailAddress?.trim().toLowerCase() ?? null;
    if (profileEmail && profileEmail !== sender) {
      return {
        status: "degraded",
        sender,
        detail: "Gmail is connected as a different mailbox.",
      };
    }
    return {
      status: "active",
      sender,
      detail: "Mailbox connected via Gmail API.",
    };
  } catch {
    return {
      status: "degraded",
      sender,
      detail: "Gmail is temporarily unavailable.",
    };
  }
}

/**
 * Proves the outreach transport works right now: credentials present, sender
 * configured, refresh token still valid, and the Gmail API answering.
 *
 * Never throws and never leaks credentials — the worst case is `degraded`.
 * This covers the send/receive transport only, not the pg_cron schedulers
 * (gmail_reply_sync, scheduled_outreach_delivery), which live outside what a
 * page request can observe; the active subtitle says what was actually checked.
 */
export async function getGmailEngineHealth(
  source: Record<string, string | undefined> = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<GmailEngineHealth> {
  const config = resolveGmailConfig(source);
  const sender = resolveGmailSender(source);
  if (!config || !sender) {
    return {
      status: "unconfigured",
      sender,
      detail: "The branch outreach mailbox is not configured.",
    };
  }

  const check = checkGmailTransport(config, sender, fetchImpl);
  // If the transport hangs past the cap, the page must still render — the
  // orphaned check resolves into the void (it cannot reject: every path
  // inside checkGmailTransport returns a value).
  const timeout = new Promise<GmailEngineHealth>((resolve) => {
    const timer = setTimeout(
      () =>
        resolve({
          status: "degraded",
          sender,
          detail: "The Gmail health check timed out.",
        }),
      CHECK_TIMEOUT_MS,
    ) as unknown as { unref?: () => void };
    timer.unref?.();
  });
  return Promise.race([check, timeout]);
}

/**
 * Whether the *other* cron job has reported since this one last did — the only
 * evidence that the scheduler is awake and this job is the one not running.
 *
 * The jobs on this card fail in one of two ways that look identical from a
 * single timestamp. Either the platform was asleep — the free plan pauses
 * between visits, pg_cron cannot tick while it is down, and every job comes
 * back hours stale together and catches up seconds later — or one job has
 * stopped while the others carry on. Only the second is worth telling a CAM
 * about: the first would put "may be stalled" on the dashboard every morning
 * for a system that is working, and the row shows its age either way, so
 * nothing is hidden by staying quiet.
 */
function siblingRanSince(rows: readonly CronHealthRow[], row: CronHealthRow): boolean {
  if (!row.last_run_at) return false;
  const sinceMs = new Date(row.last_run_at).getTime();
  if (Number.isNaN(sinceMs)) return false;
  return rows.some(
    (candidate) =>
      candidate.job_name !== row.job_name &&
      candidate.last_run_at !== null &&
      new Date(candidate.last_run_at).getTime() > sinceMs,
  );
}

/** The moment a run last reported, in the card's fixed en-GB shape. Falls back
    to whatever Postgres sent when it is not a date Node can parse, rather than
    printing "Invalid Date" into a tooltip. */
function formatRunTime(value: string): string {
  const when = new Date(value);
  return Number.isNaN(when.getTime()) ? value : formatExactTime(when);
}

/**
 * One cron job's row, described: what the job does, then what it last did.
 *
 * The description leads, because the healthy case is the common one and
 * "Last ran successfully at ..." was the whole tooltip — a sentence that tells
 * a CAM nothing they wanted to know. The timestamp still closes it, because a
 * health check that will not say when it last proved itself is not a health
 * check.
 */
function toCronJobHealth(
  row: CronHealthRow | undefined,
  job: CronJobDescriptor,
  /** Every row this read fetched, so a job can be judged against its sibling. */
  rows: readonly CronHealthRow[],
): CronJobHealth {
  if (!row || !row.last_run_at) {
    return {
      status: "unconfigured",
      detail: `${job.name} ${job.purpose}. No run has been recorded yet — it runs ${formatCadence(job.everyMs)}.`,
    };
  }
  const lastRun = formatRunTime(row.last_run_at);
  if (!row.last_run_succeeded) {
    return {
      status: "degraded",
      detail: `${job.name} ${job.purpose}, but its last run failed at ${lastRun}.`,
    };
  }
  const ageMs = Date.now() - new Date(row.last_run_at).getTime();
  if (ageMs > CRON_STALE_AFTER_MS && siblingRanSince(rows, row)) {
    return {
      status: "degraded",
      detail: `${job.name} ${job.purpose}. Its last successful run was at ${lastRun}, so it may be stalled.`,
    };
  }
  return {
    status: "active",
    detail: `${job.name} ${job.purpose}. Last run completed at ${lastRun}.`,
  };
}

/**
 * Reads the health of the reply-sync and scheduled-send pg_cron jobs via the
 * `get_outreach_cron_health` RPC — `cron.job`/`cron.job_run_details` are not
 * on PostgREST's exposed schema list, so this is the only path from a page
 * request to that state. Never throws: an RPC failure degrades both jobs
 * rather than crashing the inbox page.
 */
async function getCronJobsHealth(
  supabase: Pick<SupabaseClient, "rpc">,
): Promise<{ replySync: CronJobHealth; scheduledSend: CronJobHealth }> {
  const fallback: CronJobHealth = {
    status: "degraded",
    detail: "Could not read the schedule's status.",
  };
  try {
    const { data, error } = await supabase.rpc("get_outreach_cron_health", {
      p_job_names: [
        GMAIL_REPLY_SYNC_JOB,
        SCHEDULED_OUTREACH_DELIVERY_JOB,
        GMAIL_REPLY_CHECK_JOB,
      ],
    });
    if (error) {
      return { replySync: fallback, scheduledSend: fallback };
    }
    const rows = (data ?? []) as CronHealthRow[];
    return {
      replySync: toCronJobHealth(
        rows.find((row) => row.job_name === GMAIL_REPLY_SYNC_JOB),
        REPLY_SYNC_JOB,
        rows,
      ),
      scheduledSend: toCronJobHealth(
        rows.find((row) => row.job_name === SCHEDULED_OUTREACH_DELIVERY_JOB),
        SCHEDULED_SEND_JOB,
        rows,
      ),
    };
  } catch {
    return { replySync: fallback, scheduledSend: fallback };
  }
}

/**
 * Composes all three outreach-engine checks the inbox sidebar's status card
 * shows: the Gmail transport, and the reply-sync / scheduled-send pg_cron
 * jobs. Never throws — each check degrades independently.
 */
export async function getOutreachEngineHealth(
  supabase: Pick<SupabaseClient, "rpc">,
  source: Record<string, string | undefined> = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<OutreachEngineHealth> {
  const [transport, cronJobs] = await Promise.all([
    getGmailEngineHealth(source, fetchImpl),
    getCronJobsHealth(supabase),
  ]);
  return {
    transport,
    replySync: cronJobs.replySync,
    scheduledSend: cronJobs.scheduledSend,
  };
}
