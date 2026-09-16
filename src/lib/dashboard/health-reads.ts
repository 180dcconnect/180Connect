/**
 * The reads behind the dashboard's Data health and System health cards.
 *
 * Both functions **never reject**: each read fails on its own, is reported,
 * and comes back as null (or `{ ok: false }`), which the summarisers render as
 * "could not be loaded". The cards stream in under a Suspense boundary, and a
 * rejected promise there would take the dashboard's error page with it.
 *
 * Counts are `head: true` — no rows cross the wire — so the whole data card is
 * a handful of tiny round trips, started alongside the page's own reads.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { IngestionRunRow } from "@/app/(app)/admin/import-status/run-format";
import { reportError } from "@/lib/error-logging";
import type { OutreachEngineHealth } from "@/lib/gmail/engine-status.ts";

import type { DataHealthInput } from "./data-health";
import { SCHEDULED_JOB_NAMES, type CronJobRow, type LastUse, type SystemHealthInput } from "./system-health";

/** Same window `/admin/import-status` opens with; the card needs only each source's newest run. */
const INGESTION_WINDOW = 100;

export type DataHealthReads = Pick<
  DataHealthInput,
  "contacts" | "duplicates" | "enrichmentReview" | "missingEmail" | "runs"
>;

type ReadError = { message: string } | null;

async function countOf(
  query: PromiseLike<{ count: number | null; error: ReadError }>,
  operation: string,
): Promise<number | null> {
  try {
    const { count, error } = await query;
    if (error) {
      await reportError(error, { operation });
      return null;
    }
    return count ?? 0;
  } catch (error) {
    await reportError(error, { operation });
    return null;
  }
}

export async function readDataHealth(supabase: SupabaseClient): Promise<DataHealthReads> {
  const head = { count: "exact", head: true } as const;

  const runs = (async (): Promise<IngestionRunRow[] | null> => {
    const operation = "dashboard.data_health.ingestion_runs";
    try {
      const { data, error } = await supabase
        .from("ingestion_runs")
        .select(
          "id, api_source, job_status, records_fetched, records_inserted, records_skipped, records_failed, records_flagged, started_at, completed_at, error_message, triggered_by",
        )
        .order("started_at", { ascending: false })
        .limit(INGESTION_WINDOW)
        .overrideTypes<IngestionRunRow[], { merge: false }>();
      if (error) {
        await reportError(error, { operation });
        return null;
      }
      return data ?? [];
    } catch (error) {
      await reportError(error, { operation });
      return null;
    }
  })();

  const [contacts, duplicates, enrichmentReview, missingEmail, runRows] = await Promise.all([
    countOf(supabase.from("contacts").select("id", head), "dashboard.data_health.contacts"),
    // Admin- and leadership-readable only (RLS), which is who sees this card.
    countOf(
      supabase.from("entity_match_candidates").select("id", head).eq("match_status", "pending"),
      "dashboard.data_health.duplicates",
    ),
    countOf(
      supabase.from("enrichment_results").select("id", head).eq("needs_review", true),
      "dashboard.data_health.enrichment_review",
    ),
    countOf(
      supabase.from("organisations").select("id", head).is("contact_email", null),
      "dashboard.data_health.missing_email",
    ),
    runs,
  ]);

  return { contacts, duplicates, enrichmentReview, missingEmail, runs: runRows };
}

/** The newest non-null value of one timestamp column. */
async function newest(
  supabase: SupabaseClient,
  table: string,
  column: string,
  operation: string,
): Promise<LastUse> {
  try {
    const { data, error } = await supabase
      .from(table)
      .select(column)
      .not(column, "is", null)
      .order(column, { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      await reportError(error, { operation });
      return { ok: false };
    }
    const value = (data as Record<string, string | null> | null)?.[column] ?? null;
    return { ok: true, at: value };
  } catch (error) {
    await reportError(error, { operation });
    return { ok: false };
  }
}

export async function readSystemHealth(
  supabase: SupabaseClient,
  /** The dashboard's in-flight engine check, reused rather than asking Gmail twice. */
  engineHealth: Promise<OutreachEngineHealth> | null,
  env: Record<string, string | undefined> = process.env,
): Promise<Omit<SystemHealthInput, "now">> {
  const cronJobs = (async (): Promise<CronJobRow[] | null> => {
    const operation = "dashboard.system_health.cron_jobs";
    try {
      const { data, error } = await supabase.rpc("get_outreach_cron_health", {
        p_job_names: [...SCHEDULED_JOB_NAMES],
      });
      if (error) {
        await reportError(error, { operation });
        return null;
      }
      return (data ?? []) as CronJobRow[];
    } catch (error) {
      await reportError(error, { operation });
      return null;
    }
  })();

  const [engine, lastDraft, lastBooklet, lastScored, cronRows] = await Promise.all([
    // getOutreachEngineHealth never rejects.
    engineHealth,
    newest(supabase, "ai_generations", "created_at", "dashboard.system_health.last_draft"),
    newest(supabase, "booklet_generations", "created_at", "dashboard.system_health.last_booklet"),
    newest(supabase, "latest_scores", "scored_at", "dashboard.system_health.last_scored"),
    cronJobs,
  ]);

  const isSet = (name: string) => Boolean(env[name]?.trim());

  return {
    keys: {
      ai: isSet("GEMINI_API_KEY"),
      companiesHouse: isSet("COMPANIES_HOUSE_API_KEY"),
      charityCommission: isSet("CHARITY_COMMISSION_API_KEY"),
    },
    gmail: engine ? { status: engine.transport.status, detail: engine.transport.detail } : null,
    lastDraft,
    lastBooklet,
    lastScored,
    cronJobs: cronRows,
  };
}
