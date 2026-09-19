"use server";

import { revalidatePath } from "next/cache";

import { getViewingActor, getCurrentActor, actorFailureMessage } from "@/lib/auth/actor";
import { reportError } from "@/lib/error-logging";
import { failureNote } from "@/lib/import-failure-reason";
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
import { registerImportProgressStats } from "@/lib/ingestion/import-progress";
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
import {
  runReachBackfill,
  MAX_BACKFILL as MAX_REACH_BACKFILL,
  DEFAULT_BACKFILL as DEFAULT_REACH_BACKFILL,
} from "@/lib/charity-register/reach-backfill";
import {
  runCompanyNumberBackfill,
  MAX_BACKFILL as MAX_COMPANY_BACKFILL,
  DEFAULT_BACKFILL as DEFAULT_COMPANY_BACKFILL,
} from "@/lib/charity-register/company-number-backfill";
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
  "The register is not loaded on this deployment. Use “Refresh register” " +
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
  const authorization = await getViewingActor(IMPORT_PERMISSION);
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
  const authorization = await getViewingActor(IMPORT_PERMISSION);
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
      /**
       * Records promotion could not read at all (no usable name). Counted but
       * previously never mentioned, so an import that staged thousands and
       * added nothing named nowhere they went.
       */
      invalidData: number;
      /**
       * Records whose organisation insert failed. Each failure is logged with
       * its raw record id, and the rows keep status `error` — promotion only
       * reads `pending`, so these are NOT picked up by a re-run and need a
       * developer rather than a second press.
       */
      failed: number;
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
    const selectedCount = countCharities(parsed);
    if (selectedCount === 0) {
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
        // The status screen turns this one small, stated estimate into its
        // countdown. No per-record heartbeat writes are needed.
        run_stats: registerImportProgressStats(Math.min(selectedCount, cap)),
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
        // Still running: promotion follows this write and is most of the wall
        // clock. The finishing update below owns both status and completed_at.
        records_fetched: outcome.selected,
        records_inserted: outcome.written,
        records_skipped: outcome.unchanged,
        records_failed: 0,
        run_stats: {
          // Keep the countdown alive through promotion. This replaces the
          // initial run_stats object, so the estimate must travel with it.
          ...registerImportProgressStats(outcome.selected),
          // What this run was asked for, so the run can explain itself and
          // be repeated. Counts alone never could: "2,231 written" says
          // nothing about which 2,231, and without the criteria a rerun would
          // be a guess. Stored as the parsed filters plus the sentence the
          // confirmation dialog showed, so the screen never has to rebuild
          // that wording from the raw values.
          criteria: parsed,
          criteriaSentence: describeFilters(parsed),
          selected: outcome.selected,
          written: outcome.written,
          unchanged: outcome.unchanged,
        },
      })
      .eq("id", runId);

    const promoted = await promotePendingCharityCommissionBulkRecords();

    // Records promotion could not save are the ones that need a human, and
    // they used to be invisible: the message below never mentioned them, so an
    // import that staged thousands and added nothing read as a silent zero.
    // Logged with the run for the same reason — the counts alone in the run
    // row cannot tell a quiet all-duplicates run from a broken one.
    if (promoted.invalidData > 0 || promoted.failed > 0) {
      await reportError(
        new Error(
          `Charity register import staged ${outcome.selected} but promotion ` +
            `could not save ${promoted.invalidData + promoted.failed} ` +
            `(invalid ${promoted.invalidData}, failed ${promoted.failed}).`,
        ),
        {
          operation: "admin.charity_register.import.promote",
          actorUserId: authorization.actor.id,
          runId,
          selected: outcome.selected,
          written: outcome.written,
          unchanged: outcome.unchanged,
          inserted: promoted.inserted,
          flagged: promoted.flagged,
          // Matches certain enough that nobody was asked (see isCertainMatch).
          // Kept apart from `flagged` so the screens can count them as clients
          // we already hold rather than as work waiting for an admin.
          alreadyHeld: promoted.alreadyHeld,
          needsReview: promoted.needsReview,
          doesNotMeet: promoted.doesNotMeet,
          invalidData: promoted.invalidData,
          failed: promoted.failed,
        },
      );
    }

    // The run row's own counters describe staging; the promotion breakdown
    // joins them so the row explains the whole import on its own — Import
    // Status reads this row, and without these it can only repeat the staging
    // half ("2,231 written") while the client list tells the other half.
    await supabase
      .from("ingestion_runs")
      .update({
        run_stats: {
          // What this run was asked for, so the run can explain itself and
          // be repeated. Counts alone never could: "2,231 written" says
          // nothing about which 2,231, and without the criteria a rerun would
          // be a guess. Stored as the parsed filters plus the sentence the
          // confirmation dialog showed, so the screen never has to rebuild
          // that wording from the raw values.
          criteria: parsed,
          criteriaSentence: describeFilters(parsed),
          selected: outcome.selected,
          written: outcome.written,
          unchanged: outcome.unchanged,
          inserted: promoted.inserted,
          flagged: promoted.flagged,
          needsReview: promoted.needsReview,
          doesNotMeet: promoted.doesNotMeet,
          invalidData: promoted.invalidData,
          failed: promoted.failed,
          // Why they failed, not just how many. Without this the run row can
          // only say "311 failed to save", which is what sent an admin looking
          // for a developer with nothing for the developer to go on.
          failureReasons: promoted.failureReasons,
        },
        // The run ends here, after promotion — see the note on the staging
        // update above.
        completed_at: new Date().toISOString(),
        // A run that saved nothing did not complete, whatever the staging half
        // did — a green badge over an import that added no clients is the bug
        // this screen kept reporting. `partial` is the status for "some of it
        // worked"; nothing working at all is a failure.
        job_status:
          promoted.failed > 0
            ? promoted.inserted === 0
              ? "failed"
              : "partial"
            : selectedCount > cap
              ? "partial"
              : "completed",
      })
      .eq("id", runId);

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

    // Staging and promotion are two different counts and the message must carry
    // both: staging says how many register rows were copied (`written` counts
    // re-writes too, not just new charities), promotion says how many clients
    // resulted. Leading with promotion alone is what once reported "0 added"
    // for an import that had staged thousands — with the failed and unusable
    // rows, which live in neither count a reader can see, named rather than
    // dropped.
    const staged =
      outcome.unchanged > 0
        ? `${outcome.selected.toLocaleString()} staged (${outcome.unchanged.toLocaleString()} already held)`
        : `${outcome.selected.toLocaleString()} staged`;
    const summary = [
      staged,
      `${promoted.inserted.toLocaleString()} added to the client list`,
      promoted.needsReview > 0 ? `${promoted.needsReview.toLocaleString()} flagged for review` : "",
      promoted.doesNotMeet > 0
        ? `${promoted.doesNotMeet.toLocaleString()} did not meet the client criteria`
        : "",
      promoted.flagged > 0 ? `${promoted.flagged.toLocaleString()} matched a client already on the list` : "",
      promoted.invalidData > 0 ? `${promoted.invalidData.toLocaleString()} could not be used` : "",
      promoted.failed > 0 ? failureNote(promoted.failed, promoted.failureReasons) : "",
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
      invalidData: promoted.invalidData,
      failed: promoted.failed,
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
        message: "Nothing to fill in — every client already holds what the register publishes.",
        ...outcome,
      };
    }

    return {
      kind: "done",
      message:
        `Filled ${outcome.periods.toLocaleString()} filed ${outcome.periods === 1 ? "year" : "years"} ` +
        `across ${outcome.organisations.toLocaleString()} ${outcome.organisations === 1 ? "client" : "clients"}` +
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
        message: "Nothing to fill in — every client already holds what the register publishes.",
        ...outcome,
      };
    }

    return {
      kind: "done",
      message:
        `Filled ${outcome.fields.toLocaleString()} ${outcome.fields === 1 ? "field" : "fields"} ` +
        `across ${outcome.organisations.toLocaleString()} ${outcome.organisations === 1 ? "client" : "clients"}` +
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

/**
 * ── Geographic reach backfill ──
 *
 * The reach catch-up. See `lib/charity-register/reach-backfill.ts` for why it
 * exists — in short, the import derives reach only on the insert path, so a
 * charity already on the client list can never receive it. This is the door
 * onto it, gated and recorded exactly as the two backfills above.
 */

export type ReachBackfillState =
  | { kind: "idle"; message: string }
  | { kind: "error"; message: string }
  | { kind: "done"; message: string; organisations: number; remaining: number };

export async function runReachBackfillNow(
  _previous: ReachBackfillState,
  formData: FormData,
): Promise<ReachBackfillState> {
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
      ? Math.min(requested, MAX_REACH_BACKFILL)
      : DEFAULT_REACH_BACKFILL;

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

    const outcome = await runReachBackfill(supabase, limit);

    await supabase
      .from("ingestion_runs")
      .update({
        job_status: outcome.remaining > 0 ? "partial" : "completed",
        completed_at: new Date().toISOString(),
        records_fetched: outcome.organisations,
        // Updates in place, never an insert — the same accounting the profile
        // backfill explains above: counting these as "inserted" would put
        // organisations on Import Status that were never created.
        records_inserted: 0,
        records_skipped: 0,
        records_failed: 0,
        run_stats: {
          job: "reach_backfill",
          organisations: outcome.organisations,
          remaining: outcome.remaining,
        },
      })
      .eq("id", runId);

    await supabase.from("audit_log").insert({
      actor_user_id: authorization.actor.id,
      action: "charity_register_reach_backfilled",
      target_table: "ingestion_runs",
      target_id: runId,
      detail: {
        organisations: outcome.organisations,
        remaining: outcome.remaining,
        limit,
      },
    });

    revalidatePath("/admin/charity-commission");

    if (outcome.organisations === 0) {
      return {
        kind: "done",
        message: "Nothing to fill in — every client already has how far it works on file.",
        ...outcome,
      };
    }

    return {
      kind: "done",
      message:
        `Filled in how far ${outcome.organisations.toLocaleString()} ` +
        `${outcome.organisations === 1 ? "client works" : "clients work"}` +
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
    await reportError(error, { operation: "admin.charity_register_reach_backfill" });
    return {
      kind: "error",
      message: "The backfill could not be run. The error has been reported.",
    };
  }
}

/**
 * ── Company number backfill ──
 *
 * The second-registration-number catch-up. See
 * `lib/charity-register/company-number-backfill.ts` for why it exists — in
 * short, a charity added by hand carries only the number the CAM typed until
 * 20261005120000, and every register-aware feature works off the identifier's
 * type. This is the door onto it, gated and recorded exactly as the three
 * backfills above.
 */

export type CompanyNumberBackfillState =
  | { kind: "idle"; message: string }
  | { kind: "error"; message: string }
  | {
      kind: "done";
      message: string;
      organisations: number;
      numbers: number;
      remaining: number;
      skipped: number;
    };

export async function runCompanyNumberBackfillNow(
  _previous: CompanyNumberBackfillState,
  formData: FormData,
): Promise<CompanyNumberBackfillState> {
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
      ? Math.min(requested, MAX_COMPANY_BACKFILL)
      : DEFAULT_COMPANY_BACKFILL;

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

    const outcome = await runCompanyNumberBackfill(supabase, limit);

    await supabase
      .from("ingestion_runs")
      .update({
        job_status: outcome.remaining > 0 ? "partial" : "completed",
        completed_at: new Date().toISOString(),
        records_fetched: outcome.organisations,
        // Rows inserted into ORGANISATION_IDENTIFIERS, not organisations — the
        // same accounting the profile and reach backfills explain above:
        // counting these as "inserted" would put clients on Import Status that
        // were never created.
        records_inserted: 0,
        records_skipped: outcome.skipped,
        records_failed: 0,
        run_stats: {
          job: "company_number_backfill",
          organisations: outcome.organisations,
          numbers: outcome.numbers,
          remaining: outcome.remaining,
          skipped: outcome.skipped,
        },
      })
      .eq("id", runId);

    await supabase.from("audit_log").insert({
      actor_user_id: authorization.actor.id,
      action: "charity_register_company_numbers_backfilled",
      target_table: "ingestion_runs",
      target_id: runId,
      detail: {
        organisations: outcome.organisations,
        numbers: outcome.numbers,
        remaining: outcome.remaining,
        skipped: outcome.skipped,
        limit,
      },
    });

    revalidatePath("/admin/charity-commission");
    // The numbers land on client records, so both the list and the records
    // themselves are stale the moment this returns.
    revalidatePath("/clients");

    if (outcome.organisations === 0 && outcome.skipped === 0) {
      return {
        kind: "done",
        message:
          "Nothing outstanding — every client the register publishes a company number for already carries it.",
        ...outcome,
      };
    }

    const parts = [
      outcome.organisations > 0
        ? `Added the register's company number to ${outcome.organisations.toLocaleString()} ` +
          `${outcome.organisations === 1 ? "client" : "clients"}`
        : "Added nothing — every one of those was already done",
      outcome.skipped > 0
        ? `${outcome.skipped.toLocaleString()} were done by another run at the same time`
        : "",
      outcome.remaining > 0 ? `${outcome.remaining.toLocaleString()} still queued` : "",
    ].filter(Boolean);

    return { kind: "done", message: `${parts.join(". ")}.`, ...outcome };
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
    await reportError(error, { operation: "admin.charity_register_company_number_backfill" });
    return {
      kind: "error",
      message: "The backfill could not be run. The error has been reported.",
    };
  }
}
