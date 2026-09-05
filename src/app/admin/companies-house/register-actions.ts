"use server";

import { revalidatePath } from "next/cache";

import { getCurrentActor, actorFailureMessage } from "@/lib/auth/actor";
import { reportError } from "@/lib/error-logging";
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
import { importSelection } from "@/lib/companies-register/import";
import { promotePendingCompaniesHouseRecords } from "@/lib/standardize/write-organisations";

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
  const authorization = await getCurrentActor(IMPORT_PERMISSION);
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
  const authorization = await getCurrentActor(IMPORT_PERMISSION);
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
    if (countCompanies(parsed) === 0) {
      return {
        kind: "error",
        message: "Those filters select no companies, so there is nothing to import.",
      };
    }

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

    const promoted = await promotePendingCompaniesHouseRecords();

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
        selected: outcome.selected,
        written: outcome.written,
        added: promoted.inserted,
        limit: cap,
      },
    });

    revalidatePath("/admin/companies-house");
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
