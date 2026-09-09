"use server";

import { revalidatePath } from "next/cache";

import { getCurrentActor, actorFailureMessage } from "@/lib/auth/actor";
import { reportError } from "@/lib/error-logging";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  describeFilters,
  parseFilters,
  type CharityRegisterFilters,
} from "@/lib/charity-register/filters";
import {
  charityLabels,
  countCharities,
  previewCharities,
  registerUnavailableReason,
} from "@/lib/charity-register/sqlite";
import { LABEL_KIND } from "@/lib/charity-register/sqlite-query";
import { createDefaultIngestionStore } from "@/lib/ingestion/store";
import { importSelection } from "@/lib/charity-register/import";
import {
  runAnnualReturnBackfill,
  MAX_BACKFILL,
  DEFAULT_BACKFILL,
} from "@/lib/charity-register/annual-return-backfill";
import {
  runProfileBackfill,
  MAX_BACKFILL as MAX_PROFILE_BACKFILL,
  DEFAULT_BACKFILL as DEFAULT_PROFILE_BACKFILL,
} from "@/lib/charity-register/profile-backfill";
import { promotePendingCharityCommissionBulkRecords } from "@/lib/standardize/write-organisations";

/**
 * Server Actions behind the Charity Commission import screen.
 *
 * ── Who may run these ──
 *
 * `client:edit`, which CAMs and admins hold and viewers do not. That is a wider
 * gate than the rest of /admin, and deliberately so: the team decided the whole
 * team should be able to shape and run imports rather than queue behind an
 * admin. The safety that replaces the narrow permission is not a smaller
 * audience but a visible one — every import records who ran it, with what
 * criteria in words, and how many organisations it created.
 *
 * ── Why the service-role client ──
 *
 * `import_filter_presets` has RLS enabled with no policies, and is revoked from
 * `anon` and `authenticated` outright, so nothing in the browser can read or
 * write it. These actions are the only door, and each checks the caller before
 * opening it.
 *
 * The register itself is no longer a table at all — it is the read-only SQLite
 * file opened by `sqlite.ts` (`server-only`), which never reaches a browser
 * either. The service-role client is here for the Postgres side of an import:
 * the presets, the `ingestion_runs` row and the `raw_source_records` write.
 */

const IMPORT_PERMISSION = "client:edit" as const;

/**
 * The service-role client, or a thrown error rather than a null nobody checks.
 * Every caller here is already inside a try/catch that reports and degrades.
 */
function requireAdminClient() {
  const supabase = createAdminClient();
  if (!supabase) {
    throw new Error("Supabase admin client is not configured (SUPABASE_SERVICE_ROLE_KEY).");
  }
  return supabase;
}

/** Nobody should be able to create a hundred thousand organisations by accident. */
const MAX_IMPORT = 10_000;

/**
 * Shown when the register file is not in the deployment. Not the underlying
 * path error, which names the filesystem and helps nobody using the screen.
 */
const REGISTER_MISSING =
  "The charity register is not loaded on this deployment. Use “Refresh register” " +
  "to build it, or ask an admin to.";

export type PreviewState =
  | { kind: "idle" }
  | { kind: "error"; message: string }
  | {
      kind: "ready";
      count: number;
      description: string;
      rows: Array<{
        organisation_number: number;
        registered_charity_number: number | null;
        charity_name: string;
        latest_income: number | null;
        postcode: string | null;
        date_of_registration: string | null;
        /** The register's own free-text description of what the charity does. */
        activities: string | null;
      }>;
    };

/**
 * How many charities the current filters select, plus a sample of them.
 *
 * Called on every filter change, which is the point: the number moving as you
 * widen a bound is what makes the criteria understandable. Counting is a
 * `head: true` query over an indexed table, so it stays cheap enough for that.
 */
export async function previewRegisterSelection(
  filters: CharityRegisterFilters,
): Promise<PreviewState> {
  const authorization = await getCurrentActor(IMPORT_PERMISSION);
  if (!authorization.ok) {
    return { kind: "error", message: actorFailureMessage(authorization.reason) };
  }

  const unavailable = registerUnavailableReason();
  if (unavailable) return { kind: "error", message: REGISTER_MISSING };

  try {
    const parsed = parseFilters(filters);
    return {
      kind: "ready",
      count: countCharities(parsed),
      description: describeFilters(parsed),
      rows: previewCharities(parsed, 25).map((row) => ({
        organisation_number: row.organisation_number,
        registered_charity_number: row.registered_charity_number,
        charity_name: row.charity_name,
        latest_income: row.latest_income,
        postcode: row.postcode,
        date_of_registration: row.date_of_registration,
        activities: row.activities,
      })),
    };
  } catch (error) {
    await reportError(error, {
      operation: "admin.charity_register.preview",
      actorUserId: authorization.actor.id,
    });
    return {
      kind: "error",
      message: "The register could not be searched. The failure was recorded — try again.",
    };
  }
}

/** Just the count, for the controls that update as they are dragged. */
export async function countRegisterSelection(
  filters: CharityRegisterFilters,
): Promise<{ count: number } | { error: string }> {
  const authorization = await getCurrentActor(IMPORT_PERMISSION);
  if (!authorization.ok) return { error: actorFailureMessage(authorization.reason) };

  const unavailable = registerUnavailableReason();
  if (unavailable) return { error: REGISTER_MISSING };

  try {
    return { count: countCharities(parseFilters(filters)) };
  } catch (error) {
    await reportError(error, {
      operation: "admin.charity_register.count",
      actorUserId: authorization.actor.id,
    });
    return { error: "The register could not be searched." };
  }
}

/**
 * The classifications and areas the register gives one charity.
 *
 * Read from the file per charity rather than joined into the selection query:
 * a charity carries several of each, and returning them as extra rows would
 * multiply a 2,000-charity import into tens of thousands of rows to regroup.
 */
function labelsForCharity(organisationNumber: number): { what: string[]; areas: string[] } {
  return {
    what: charityLabels(organisationNumber, LABEL_KIND.what),
    areas: charityLabels(organisationNumber, LABEL_KIND.localAuthority),
  };
}

export type ImportState =
  | { kind: "idle" }
  | { kind: "error"; message: string }
  | {
      kind: "done";
      message: string;
      selected: number;
      written: number;
      unchanged: number;
      added: number;
      needsReview: number;
      doesNotMeet: number;
      /** Matched an organisation already on the list, so flagged rather than added. */
      duplicates: number;
    };

/**
 * Imports everything the filters select.
 *
 * Three steps, in order, and each one visible in its own right afterwards:
 *   1. open an `ingestion_runs` row, so the import appears in Import Status
 *      alongside every other ingestion;
 *   2. copy the selection into `raw_source_records` (idempotent by checksum);
 *   3. run the existing bulk promote path, which standardises, applies the
 *      client-criteria check and writes the organisations and their financials.
 */
export async function runRegisterImport(
  filters: CharityRegisterFilters,
  limit?: number,
): Promise<ImportState> {
  const authorization = await getCurrentActor(IMPORT_PERMISSION);
  if (!authorization.ok) {
    return { kind: "error", message: actorFailureMessage(authorization.reason) };
  }

  const parsed = parseFilters(filters);
  const cap = Math.min(limit ?? MAX_IMPORT, MAX_IMPORT);

  let runId: string | null = null;
  let supabase: ReturnType<typeof requireAdminClient>;
  try {
    supabase = requireAdminClient();
  } catch (error) {
    await reportError(error, {
      operation: "admin.charity_register.import",
      actorUserId: authorization.actor.id,
    });
    return { kind: "error", message: "The import is not configured on this environment." };
  }

  const unavailable = registerUnavailableReason();
  if (unavailable) return { kind: "error", message: REGISTER_MISSING };

  try {
    // Counted again here rather than trusting the number the browser last saw:
    // a register refresh may have landed between the preview and the click.
    if (countCharities(parsed) === 0) {
      return {
        kind: "error",
        message: "Those filters select no charities, so there is nothing to import.",
      };
    }

    // F246/F247, fail-closed exactly as the ingestion runner does: if the data
    // handling rules cannot be read, nothing is imported. Better to import
    // nothing than to store a personal email address the rules exclude.
    const store = createDefaultIngestionStore();
    if (!store) throw new Error("Ingestion store is not configured.");
    const policy = await store.loadDataHandlingPolicy();

    const { data: run, error: runError } = await supabase
      .from("ingestion_runs")
      .insert({
        api_source: "charity_commission_bulk",
        triggered_by: "manual",
        triggered_by_user_id: authorization.actor.id,
        job_status: "running",
      })
      .select("id")
      .single();
    if (runError) throw runError;
    runId = run.id as string;

    const outcome = await importSelection(supabase, parsed, runId, policy, cap, labelsForCharity);
    if ("error" in outcome) throw new Error(outcome.error);

    await supabase
      .from("ingestion_runs")
      .update({
        job_status: outcome.selected > cap ? "partial" : "completed",
        completed_at: new Date().toISOString(),
        records_fetched: outcome.selected,
        records_inserted: outcome.written,
        records_skipped: outcome.unchanged,
        records_failed: 0,
        run_stats: {
          selected: outcome.selected,
          written: outcome.written,
          unchanged: outcome.unchanged,
        },
      })
      .eq("id", runId);

    const promoted = await promotePendingCharityCommissionBulkRecords();

    // The criteria in words, not just the count: an import is the awkward thing
    // to undo on this screen, and "2,000 organisations" tells nobody later what
    // was actually asked for.
    await supabase.from("audit_log").insert({
      actor_user_id: authorization.actor.id,
      action: "charity_register_imported",
      target_table: "ingestion_runs",
      target_id: runId,
      detail: {
        filters: parsed as unknown as Record<string, unknown>,
        description: describeFilters(parsed),
        selected: outcome.selected,
        written: outcome.written,
        added: promoted.inserted,
        limit: cap,
      },
    });

    revalidatePath("/admin/charity-commission");
    revalidatePath("/clients");

    const summary = [
      `${promoted.inserted.toLocaleString()} added to the client list`,
      promoted.needsReview > 0 ? `${promoted.needsReview.toLocaleString()} flagged for review` : "",
      promoted.doesNotMeet > 0
        ? `${promoted.doesNotMeet.toLocaleString()} did not meet the client criteria`
        : "",
      promoted.flagged > 0 ? `${promoted.flagged.toLocaleString()} matched a client already on the list` : "",
      outcome.unchanged > 0 ? `${outcome.unchanged.toLocaleString()} already held` : "",
    ]
      .filter(Boolean)
      .join(", ");

    return {
      kind: "done",
      message: summary ? `${summary}.` : "Nothing new to add.",
      selected: outcome.selected,
      written: outcome.written,
      unchanged: outcome.unchanged,
      added: promoted.inserted,
      needsReview: promoted.needsReview,
      doesNotMeet: promoted.doesNotMeet,
      duplicates: promoted.flagged,
    };
  } catch (error) {
    if (runId) {
      await supabase
        .from("ingestion_runs")
        .update({
          job_status: "failed",
          completed_at: new Date().toISOString(),
          error_message: error instanceof Error ? error.message : String(error),
        })
        .eq("id", runId);
    }
    await reportError(error, {
      operation: "admin.charity_register.import",
      actorUserId: authorization.actor.id,
    });
    return {
      kind: "error",
      message: "The import failed. The failure was recorded — nothing partial was left behind.",
    };
  }
}

export type PresetState =
  | { ok: true; message: string }
  | { ok: false; message: string };

/**
 * Saves under a name, replacing any set already holding it.
 *
 * The conflict target is `(source, name_key)`, the generated normalised column
 * added in 20260923130000 — `ON CONFLICT (source, name)` cannot match the
 * expression index the table shipped with, which is why no save on this screen
 * ever succeeded before that migration.
 */
export async function saveFilterPreset(
  name: string,
  filters: CharityRegisterFilters,
  description?: string,
): Promise<PresetState> {
  const authorization = await getCurrentActor(IMPORT_PERMISSION);
  if (!authorization.ok) {
    return { ok: false, message: actorFailureMessage(authorization.reason) };
  }

  const trimmed = name.trim();
  if (!trimmed) return { ok: false, message: "Give the filter set a name." };

  try {
    const supabase = requireAdminClient();
    const parsed = parseFilters(filters);

    // Whether this replaces a set is worth telling the person before they walk
    // away, so it is read first rather than inferred from the upsert.
    const { data: existing } = await supabase
      .from("import_filter_presets")
      .select("id")
      .eq("source", "charity_commission")
      .eq("name_key", trimmed.toLowerCase())
      .maybeSingle();

    const { error } = await supabase.from("import_filter_presets").upsert(
      {
        name: trimmed,
        description: description?.trim() || describeFilters(parsed),
        filters: parsed as unknown as Record<string, unknown>,
        source: "charity_commission",
        created_by_user_id: authorization.actor.id,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "source,name_key" },
    );
    if (error) throw error;

    revalidatePath("/admin/charity-commission");
    return {
      ok: true,
      message: existing ? `Replaced “${trimmed}”.` : `Saved as “${trimmed}”.`,
    };
  } catch (error) {
    await reportError(error, {
      operation: "admin.charity_register.save_preset",
      actorUserId: authorization.actor.id,
    });
    return { ok: false, message: "The filter set could not be saved." };
  }
}

export async function deleteFilterPreset(id: string): Promise<PresetState> {
  const authorization = await getCurrentActor(IMPORT_PERMISSION);
  if (!authorization.ok) {
    return { ok: false, message: actorFailureMessage(authorization.reason) };
  }

  try {
    const supabase = requireAdminClient();
    const { error } = await supabase.from("import_filter_presets").delete().eq("id", id);
    if (error) throw error;
    revalidatePath("/admin/charity-commission");
    return { ok: true, message: "Filter set deleted." };
  } catch (error) {
    await reportError(error, {
      operation: "admin.charity_register.delete_preset",
      actorUserId: authorization.actor.id,
    });
    return { ok: false, message: "The filter set could not be deleted." };
  }
}

/**
 * ── Annual return backfill ──
 *
 * The Part B catch-up. See `lib/charity-register/annual-return-backfill.ts` for
 * why it exists; this is the door onto it, gated the same way every other
 * action on this screen is and recorded the same way an import is.
 */

export type AnnualReturnBackfillState =
  | { kind: "idle"; message: string }
  | { kind: "error"; message: string }
  | { kind: "done"; message: string; organisations: number; periods: number; remaining: number };

export async function runAnnualReturnBackfillNow(
  _previous: AnnualReturnBackfillState,
  formData: FormData,
): Promise<AnnualReturnBackfillState> {
  const authorization = await getCurrentActor(IMPORT_PERMISSION);
  if (!authorization.ok) {
    return { kind: "error", message: actorFailureMessage(authorization.reason) };
  }

  if (registerUnavailableReason()) {
    return { kind: "error", message: REGISTER_MISSING };
  }

  const requested = Number(formData.get("batchSize"));
  const limit =
    Number.isInteger(requested) && requested > 0
      ? Math.min(requested, MAX_BACKFILL)
      : DEFAULT_BACKFILL;

  let runId: string | null = null;
  try {
    const supabase = requireAdminClient();

    const { data: run, error: runError } = await supabase
      .from("ingestion_runs")
      .insert({
        api_source: "charity_commission_bulk",
        triggered_by: "manual",
        triggered_by_user_id: authorization.actor.id,
        job_status: "running",
      })
      .select("id")
      .single();
    if (runError) throw runError;
    runId = run.id as string;

    const outcome = await runAnnualReturnBackfill(supabase, limit);

    await supabase
      .from("ingestion_runs")
      .update({
        job_status: outcome.remaining > 0 ? "partial" : "completed",
        completed_at: new Date().toISOString(),
        records_fetched: outcome.organisations,
        records_inserted: outcome.periods,
        records_skipped: 0,
        records_failed: 0,
        run_stats: {
          job: "annual_return_backfill",
          organisations: outcome.organisations,
          periods: outcome.periods,
          remaining: outcome.remaining,
        },
      })
      .eq("id", runId);

    await supabase.from("audit_log").insert({
      actor_user_id: authorization.actor.id,
      action: "charity_annual_return_backfilled",
      target_table: "ingestion_runs",
      target_id: runId,
      detail: {
        organisations: outcome.organisations,
        periods: outcome.periods,
        remaining: outcome.remaining,
        limit,
      },
    });

    revalidatePath("/admin/charity-commission");

    if (outcome.organisations === 0) {
      return {
        kind: "done",
        message: "Nothing to fill in — every charity already holds what the register publishes.",
        ...outcome,
      };
    }

    return {
      kind: "done",
      message:
        `Filled ${outcome.periods.toLocaleString()} filed ${outcome.periods === 1 ? "year" : "years"} ` +
        `across ${outcome.organisations.toLocaleString()} ${outcome.organisations === 1 ? "charity" : "charities"}` +
        (outcome.remaining > 0 ? `. ${outcome.remaining.toLocaleString()} still queued.` : "."),
      ...outcome,
    };
  } catch (error) {
    if (runId) {
      const supabase = createAdminClient();
      await supabase
        ?.from("ingestion_runs")
        .update({
          job_status: "failed",
          completed_at: new Date().toISOString(),
          error_message: error instanceof Error ? error.message : String(error),
        })
        .eq("id", runId);
    }
    await reportError(error, { operation: "admin.charity_annual_return_backfill" });
    return {
      kind: "error",
      message: "The backfill could not be run. The error has been reported.",
    };
  }
}

/**
 * ── Register profile backfill ──
 *
 * The activities/sector catch-up. See
 * `lib/charity-register/profile-backfill.ts` for why it exists — in short, the
 * import writes these four fields only on the insert path, so a charity already
 * on the client list can never receive them. This is the door onto it, gated
 * and recorded exactly as the Part B backfill beside it.
 */

export type ProfileBackfillState =
  | { kind: "idle"; message: string }
  | { kind: "error"; message: string }
  | { kind: "done"; message: string; organisations: number; fields: number; remaining: number };

export async function runProfileBackfillNow(
  _previous: ProfileBackfillState,
  formData: FormData,
): Promise<ProfileBackfillState> {
  const authorization = await getCurrentActor(IMPORT_PERMISSION);
  if (!authorization.ok) {
    return { kind: "error", message: actorFailureMessage(authorization.reason) };
  }

  if (registerUnavailableReason()) {
    return { kind: "error", message: REGISTER_MISSING };
  }

  const requested = Number(formData.get("batchSize"));
  const limit =
    Number.isInteger(requested) && requested > 0
      ? Math.min(requested, MAX_PROFILE_BACKFILL)
      : DEFAULT_PROFILE_BACKFILL;

  let runId: string | null = null;
  try {
    const supabase = requireAdminClient();

    const { data: run, error: runError } = await supabase
      .from("ingestion_runs")
      .insert({
        api_source: "charity_commission_bulk",
        triggered_by: "manual",
        triggered_by_user_id: authorization.actor.id,
        job_status: "running",
      })
      .select("id")
      .single();
    if (runError) throw runError;
    runId = run.id as string;

    const outcome = await runProfileBackfill(supabase, limit);

    await supabase
      .from("ingestion_runs")
      .update({
        job_status: outcome.remaining > 0 ? "partial" : "completed",
        completed_at: new Date().toISOString(),
        records_fetched: outcome.organisations,
        // This job updates organisations in place and never inserts one. There
        // is no records_updated column, and counting the updates as "inserted"
        // would put organisations on Import Status that were never created —
        // so the count stays zero here and the real figures live in run_stats,
        // which is where the admin card reads them from anyway.
        records_inserted: 0,
        records_skipped: 0,
        records_failed: 0,
        run_stats: {
          job: "profile_backfill",
          organisations: outcome.organisations,
          fields: outcome.fields,
          remaining: outcome.remaining,
        },
      })
      .eq("id", runId);

    await supabase.from("audit_log").insert({
      actor_user_id: authorization.actor.id,
      action: "charity_register_profile_backfilled",
      target_table: "ingestion_runs",
      target_id: runId,
      detail: {
        organisations: outcome.organisations,
        fields: outcome.fields,
        remaining: outcome.remaining,
        limit,
      },
    });

    revalidatePath("/admin/charity-commission");

    if (outcome.organisations === 0) {
      return {
        kind: "done",
        message: "Nothing to fill in — every charity already holds what the register publishes.",
        ...outcome,
      };
    }

    return {
      kind: "done",
      message:
        `Filled ${outcome.fields.toLocaleString()} ${outcome.fields === 1 ? "field" : "fields"} ` +
        `across ${outcome.organisations.toLocaleString()} ${outcome.organisations === 1 ? "charity" : "charities"}` +
        (outcome.remaining > 0 ? `. ${outcome.remaining.toLocaleString()} still queued.` : "."),
      ...outcome,
    };
  } catch (error) {
    if (runId) {
      const supabase = createAdminClient();
      await supabase
        ?.from("ingestion_runs")
        .update({
          job_status: "failed",
          completed_at: new Date().toISOString(),
          error_message: error instanceof Error ? error.message : String(error),
        })
        .eq("id", runId);
    }
    await reportError(error, { operation: "admin.charity_register_profile_backfill" });
    return {
      kind: "error",
      message: "The backfill could not be run. The error has been reported.",
    };
  }
}
