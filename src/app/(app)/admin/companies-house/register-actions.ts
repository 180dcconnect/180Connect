"use server";

import { revalidatePath } from "next/cache";

import { getViewingActor, getCurrentActor, actorFailureMessage } from "@/lib/auth/actor";
import { reportError } from "@/lib/error-logging";
import { failureNote } from "@/lib/import-failure-reason";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  describeFilters,
  parseFilters,
  type CompanyRegisterFilters,
} from "@/lib/companies-register/filters";
import {
  companiesRegisterUnavailableReason,
  countCompanies,
  previewCompanies,
} from "@/lib/companies-register/sqlite";
import { createDefaultIngestionStore } from "@/lib/ingestion/store";
import { registerImportProgressStats } from "@/lib/ingestion/import-progress";
import { importSelection } from "@/lib/companies-register/import";
import { promotePendingCompaniesHouseRecords } from "@/lib/standardize/write-organisations";
import { ocrUnavailableReason } from "@/lib/cic-statement/ocr";
import {
  DEFAULT_BACKFILL as DEFAULT_CIC_BACKFILL,
  MAX_BACKFILL as MAX_CIC_BACKFILL,
  runCicBackfill,
} from "@/lib/cic-statement/backfill";

/**
 * Server Actions behind the Companies House import screen.
 *
 * The twin of the Charity Commission's register-actions: same permissions,
 * same three-step import (open run row, copy selection idempotently, promote
 * through the existing path), same audit trail. The differences are the
 * register it reads and the promote path it finishes with — everything a
 * reader needs to tell the two apart is in those two imports.
 *
 * ── Who may run these ──
 *
 * `client:edit`, which CAMs and admins hold and viewers do not — the same
 * deliberately wide gate as charity imports. The safety is visibility, not
 * scarcity: every import records who ran it, with what criteria in words,
 * and how many organisations it created.
 *
 * ── Why the service-role client ──
 *
 * `import_filter_presets` has RLS enabled with no policies, and is revoked
 * from `anon` and `authenticated` outright. These actions are the only door,
 * and each checks the caller before opening it. The register itself is the
 * read-only SQLite file opened by `sqlite.ts` (`server-only`).
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
  "The companies register is not loaded on this deployment. Use “Refresh register” " +
  "to build it, or ask an admin to.";

export type PreviewState =
  | { kind: "idle" }
  | { kind: "error"; message: string }
  | {
      kind: "ready";
      count: number;
      description: string;
      rows: Array<{
        number: string;
        name: string;
        cat_slug: string | null;
        status_norm: string | null;
        postcode: string | null;
        town: string | null;
        incorp_date: string | null;
        is_cic: number | null;
      }>;
    };

/**
 * How many companies the current filters select, plus a sample of them.
 *
 * Called on every filter change, which is the point: the number moving as you
 * tick SIC codes is what makes the criteria understandable.
 */
export async function previewCompaniesSelection(
  filters: CompanyRegisterFilters,
): Promise<PreviewState> {
  const authorization = await getViewingActor(IMPORT_PERMISSION);
  if (!authorization.ok) {
    return { kind: "error", message: actorFailureMessage(authorization.reason) };
  }

  const unavailable = companiesRegisterUnavailableReason();
  if (unavailable) return { kind: "error", message: REGISTER_MISSING };

  try {
    const parsed = parseFilters(filters);
    return {
      kind: "ready",
      count: countCompanies(parsed),
      description: describeFilters(parsed),
      rows: previewCompanies(parsed, 25).map((row) => ({
        number: row.number,
        name: row.name,
        cat_slug: row.cat_slug,
        status_norm: row.status_norm,
        postcode: row.postcode,
        town: row.town,
        incorp_date: row.incorp_date,
        is_cic: row.is_cic,
      })),
    };
  } catch (error) {
    await reportError(error, {
      operation: "admin.companies_register.preview",
      actorUserId: authorization.actor.id,
    });
    return {
      kind: "error",
      message: "The register could not be searched. The failure was recorded — try again.",
    };
  }
}

/** Just the count, for the controls that update as they are used. */
export async function countCompaniesSelection(
  filters: CompanyRegisterFilters,
): Promise<{ count: number } | { error: string }> {
  const authorization = await getViewingActor(IMPORT_PERMISSION);
  if (!authorization.ok) return { error: actorFailureMessage(authorization.reason) };

  const unavailable = companiesRegisterUnavailableReason();
  if (unavailable) return { error: REGISTER_MISSING };

  try {
    return { count: countCompanies(parseFilters(filters)) };
  } catch (error) {
    await reportError(error, {
      operation: "admin.companies_register.count",
      actorUserId: authorization.actor.id,
    });
    return { error: "The register could not be searched." };
  }
}

export type ImportState =
  | { kind: "idle" }
  | { kind: "error"; message: string }
  | {
      kind: "done";
      message: string;
      /** How many the filters matched in the register, before the cap. */
      available: number;
      /** The ceiling this run was held to. */
      cap: number;
      /** True when `available` exceeded `cap`, so most of the match was left. */
      truncated: boolean;
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
 *   3. run the existing companies_house promote path, which standardises,
 *      applies the client-criteria check (with the Tier A/B strong-evidence
 *      bypass) and writes the organisations and their identifiers.
 */
export async function runCompaniesRegisterImport(
  filters: CompanyRegisterFilters,
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
      operation: "admin.companies_register.import",
      actorUserId: authorization.actor.id,
    });
    return { kind: "error", message: "The import is not configured on this environment." };
  }

  const unavailable = companiesRegisterUnavailableReason();
  if (unavailable) return { kind: "error", message: REGISTER_MISSING };

  try {
    // Counted again here rather than trusting the number the browser last saw:
    // a register refresh may have landed between the preview and the click.
    //
    // Kept, not discarded: this is the only number that knows how big the
    // match really was. Everything after the cap reports 10,000 whether the
    // filters matched 10,000 or 716,282, so truncation is invisible from
    // downstream counts alone — which is exactly the bug this replaced.
    const available = countCompanies(parsed);
    if (available === 0) {
      return {
        kind: "error",
        message: "Those filters select no companies, so there is nothing to import.",
      };
    }
    const truncated = available > cap;

    // F246/F247, fail-closed exactly as the ingestion runner does: if the data
    // handling rules cannot be read, nothing is imported.
    const store = createDefaultIngestionStore();
    if (!store) throw new Error("Ingestion store is not configured.");
    const policy = await store.loadDataHandlingPolicy();

    const { data: run, error: runError } = await supabase
      .from("ingestion_runs")
      .insert({
        api_source: "companies_house",
        triggered_by: "manual",
        triggered_by_user_id: authorization.actor.id,
        job_status: "running",
        // The status screen turns this one small, stated estimate into its
        // countdown. No per-record heartbeat writes are needed.
        run_stats: registerImportProgressStats(Math.min(available, cap)),
      })
      .select("id")
      .single();
    if (runError) throw runError;
    runId = run.id as string;

    const outcome = await importSelection(supabase, parsed, runId, policy, cap);
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
          available,
          cap,
          truncated,
          selected: outcome.selected,
          written: outcome.written,
          unchanged: outcome.unchanged,
        },
      })
      .eq("id", runId);

    const promoted = await promotePendingCompaniesHouseRecords();

    // Records promotion could not save are the ones that need a human, and
    // they used to be invisible: the message below never mentioned them, so an
    // import that staged thousands and added nothing read as a silent zero.
    // Logged with the run for the same reason — the counts alone in the run
    // row cannot tell a quiet all-duplicates run from a broken one.
    if (promoted.invalidData > 0 || promoted.failed > 0) {
      await reportError(
        new Error(
          `Companies register import staged ${outcome.selected} but promotion ` +
            `could not save ${promoted.invalidData + promoted.failed} ` +
            `(invalid ${promoted.invalidData}, failed ${promoted.failed}).`,
        ),
        {
          operation: "admin.companies_register.import.promote",
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
          available,
          cap,
          truncated,
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
            : truncated
              ? "partial"
              : "completed",
      })
      .eq("id", runId);

    // The criteria in words, not just the count: an import is the awkward thing
    // to undo on this screen, and "2,000 organisations" tells nobody later what
    // was actually asked for.
    await supabase.from("audit_log").insert({
      actor_user_id: authorization.actor.id,
      action: "companies_register_imported",
      target_table: "ingestion_runs",
      target_id: runId,
      detail: {
        filters: parsed as unknown as Record<string, unknown>,
        description: describeFilters(parsed),
        available,
        truncated,
        selected: outcome.selected,
        written: outcome.written,
        added: promoted.inserted,
        limit: cap,
      },
    });

    revalidatePath("/admin/companies-house");
    revalidatePath("/clients");

    // Staging and promotion are two different counts and the message must carry
    // both: staging says how many register rows were copied (`written` counts
    // re-writes too, not just new companies), promotion says how many clients
    // resulted.
    const staged =
      outcome.unchanged > 0
        ? `${outcome.selected.toLocaleString()} staged (${outcome.unchanged.toLocaleString()} already held)`
        : `${outcome.selected.toLocaleString()} staged`;
    const summary = [
      truncated
        ? `Imported the first ${cap.toLocaleString()} of ${available.toLocaleString()} matching companies`
        : staged,
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
      message: summary
        ? truncated
          ? `${summary}. Narrow the filters and run again for the rest.`
          : `${summary}.`
        : "Nothing new to add.",
      available,
      cap,
      truncated,
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
      operation: "admin.companies_register.import",
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
 * The conflict target is `(source, name_key)` — `source` is unconstrained
 * text, so `companies_house` sets sit beside `charity_commission` ones with
 * no migration.
 */
export async function saveCompaniesFilterPreset(
  name: string,
  filters: CompanyRegisterFilters,
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
      .eq("source", "companies_house")
      .eq("name_key", trimmed.toLowerCase())
      .maybeSingle();

    const { error } = await supabase.from("import_filter_presets").upsert(
      {
        name: trimmed,
        description: description?.trim() || describeFilters(parsed),
        filters: parsed as unknown as Record<string, unknown>,
        source: "companies_house",
        created_by_user_id: authorization.actor.id,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "source,name_key" },
    );
    if (error) throw error;

    revalidatePath("/admin/companies-house");
    return {
      ok: true,
      message: existing ? `Replaced “${trimmed}”.` : `Saved as “${trimmed}”.`,
    };
  } catch (error) {
    await reportError(error, {
      operation: "admin.companies_register.save_preset",
      actorUserId: authorization.actor.id,
    });
    return { ok: false, message: "The filter set could not be saved." };
  }
}

export async function deleteCompaniesFilterPreset(id: string): Promise<PresetState> {
  const authorization = await getCurrentActor(IMPORT_PERMISSION);
  if (!authorization.ok) {
    return { ok: false, message: actorFailureMessage(authorization.reason) };
  }

  try {
    const supabase = requireAdminClient();
    const { error } = await supabase.from("import_filter_presets").delete().eq("id", id);
    if (error) throw error;
    revalidatePath("/admin/companies-house");
    return { ok: true, message: "Filter set deleted." };
  } catch (error) {
    await reportError(error, {
      operation: "admin.companies_register.delete_preset",
      actorUserId: authorization.actor.id,
    });
    return { ok: false, message: "The filter set could not be deleted." };
  }
}

/**
 * ── CIC36 community interest statement backfill ──
 *
 * The companies-side twin of the charity register's profile backfill, and the
 * door onto `lib/cic-statement/`. Gated and recorded the same way.
 *
 * One difference worth knowing before pressing it: this job is expensive. Each
 * company costs two Companies House calls, a ~1.2MB download and several
 * seconds of OCR, so MAX_CIC_BACKFILL is small and a full catch-up belongs to
 * `npm run backfill:cic-statements`, which has no function-timeout ceiling.
 * This button is for topping up after an import has added a few dozen CICs.
 */

export type CicBackfillState =
  | { kind: "idle"; message: string }
  | { kind: "error"; message: string }
  | {
      kind: "done";
      message: string;
      attempted: number;
      written: number;
      remaining: number;
    };

export async function runCicStatementBackfillNow(
  _previous: CicBackfillState,
  formData: FormData,
): Promise<CicBackfillState> {
  const authorization = await getCurrentActor(IMPORT_PERMISSION);
  if (!authorization.ok) {
    return { kind: "error", message: actorFailureMessage(authorization.reason) };
  }

  // Checked before a run row is opened: a missing language model is a
  // deployment problem, and recording a failed ingestion run for it would put
  // noise on Import Status that says nothing about the data.
  const ocrProblem = ocrUnavailableReason();
  if (ocrProblem) return { kind: "error", message: ocrProblem };

  if (!process.env.COMPANIES_HOUSE_API_KEY?.trim()) {
    return { kind: "error", message: "The Companies House API key is not configured." };
  }

  const requested = Number(formData.get("batchSize"));
  const limit =
    Number.isInteger(requested) && requested > 0
      ? Math.min(requested, MAX_CIC_BACKFILL)
      : DEFAULT_CIC_BACKFILL;

  let runId: string | null = null;
  try {
    const supabase = requireAdminClient();

    // Fails closed, exactly as the ingestion runner does: if the data handling
    // rules cannot be read, nothing is fetched. The statement is externally
    // authored text out of a document full of personal data, and storing it
    // unfiltered is the one outcome that must be impossible.
    const policy = await createDefaultIngestionStore()?.loadDataHandlingPolicy();
    if (!policy) {
      return {
        kind: "error",
        message: "The data handling rules could not be read, so nothing was fetched.",
      };
    }

    const { data: run, error: runError } = await supabase
      .from("ingestion_runs")
      .insert({
        api_source: "companies_house",
        triggered_by: "manual",
        triggered_by_user_id: authorization.actor.id,
        job_status: "running",
      })
      .select("id")
      .single();
    if (runError) throw runError;
    runId = run.id as string;

    const outcome = await runCicBackfill(supabase, limit, policy);

    await supabase
      .from("ingestion_runs")
      .update({
        job_status: outcome.remaining > 0 ? "partial" : "completed",
        completed_at: new Date().toISOString(),
        records_fetched: outcome.attempted,
        // Updates organisations in place and never inserts one — same reasoning
        // as the charity profile backfill: counting these as "inserted" would
        // put organisations on Import Status that were never created.
        records_inserted: 0,
        records_skipped: outcome.notCic,
        records_failed: outcome.failed,
        run_stats: {
          job: "cic_statement_backfill",
          attempted: outcome.attempted,
          written: outcome.written,
          notCic: outcome.notCic,
          failed: outcome.failed,
          remaining: outcome.remaining,
        },
      })
      .eq("id", runId);

    await supabase.from("audit_log").insert({
      actor_user_id: authorization.actor.id,
      action: "cic_statement_backfilled",
      target_table: "ingestion_runs",
      target_id: runId,
      detail: {
        attempted: outcome.attempted,
        written: outcome.written,
        notCic: outcome.notCic,
        failed: outcome.failed,
        remaining: outcome.remaining,
        limit,
      },
    });

    revalidatePath("/admin/companies-house");

    if (outcome.attempted === 0) {
      return {
        kind: "done",
        message: "Nothing queued — every company has already been asked about.",
        attempted: 0,
        written: 0,
        remaining: outcome.remaining,
      };
    }

    const parts = [
      `Read ${outcome.written.toLocaleString()} ${outcome.written === 1 ? "statement" : "statements"} from ${outcome.attempted.toLocaleString()} ${outcome.attempted === 1 ? "company" : "companies"}`,
    ];
    if (outcome.notCic > 0) {
      parts.push(`${outcome.notCic.toLocaleString()} had no CIC36 on file`);
    }
    if (outcome.failed > 0) {
      parts.push(`${outcome.failed.toLocaleString()} failed and stayed queued`);
    }
    if (outcome.remaining > 0) {
      parts.push(`${outcome.remaining.toLocaleString()} still queued`);
    }

    return {
      kind: "done",
      message: `${parts.join(". ")}.`,
      attempted: outcome.attempted,
      written: outcome.written,
      remaining: outcome.remaining,
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
    await reportError(error, { operation: "admin.cic_statement_backfill" });
    return {
      kind: "error",
      message: "The backfill could not be run. The error has been reported.",
    };
  }
}
