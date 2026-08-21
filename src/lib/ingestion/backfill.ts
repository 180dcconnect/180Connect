// Retroactive data handling rule backfill (F246).
//
// The runner filters payloads on the way in, which protects everything ingested
// after the rules existed. It does nothing for rows already sitting in
// `raw_source_records` — and those were written by exactly the same source APIs,
// so whatever the rules now deny is, in all likelihood, already stored.
//
// The policy's commitment ("a field the rules exclude is discarded before it is
// written") is not met by a forward-only control while the old rows remain, so
// this pass applies the active rules to what is already there: it strips denied
// fields from stored payloads, recomputes the checksum to match what is actually
// stored, and stamps `excluded_fields` / `rule_version_applied` on every row it
// visits — including rows nothing was stripped from, which is how an auditor
// tells "checked, clean" from "never checked".
//
// Run it after any rule change that adds or widens a deny, not only once:
//   npm run backfill:data-handling-rules -- --dry-run
//   npm run backfill:data-handling-rules
//
// Deliberately NOT a migration. It rewrites an unbounded number of rows and
// wants a dry run first; a migration gives neither, and would run inside a
// transaction holding locks on the largest table in the schema.

import type { SupabaseClient } from "@supabase/supabase-js";
import { hashPayload } from "./checksum.ts";
import { filterPayload, type FieldRule } from "./field-filter.ts";
import type { DataSourceName } from "./type.ts";

/** Rows per round trip. Matches the ingestion store's batch size. */
const BATCH_SIZE = 500;

/** The columns the backfill needs to read. */
export type BackfillRow = {
  id: string;
  record_source: DataSourceName;
  raw_payload: unknown;
  rule_version_applied: number | null;
};

/** The columns the backfill writes, for a row that needs writing. */
export type RowUpdate = {
  id: string;
  raw_payload?: unknown;
  checksum?: string;
  excluded_fields: string[];
  rule_version_applied: number;
};

export type BackfillSummary = {
  scanned: number;
  /** Rows where at least one field was stripped from the stored payload. */
  stripped: number;
  /** Rows already carrying this rule version, so nothing to do. */
  alreadyCurrent: number;
  /** How many times each field path matched, across every row. */
  fieldCounts: Record<string, number>;
  ruleVersion: number;
  dryRun: boolean;
};

/**
 * Decides what, if anything, one stored row needs.
 *
 * Pure and exported for its own tests — this is where the "is this row already
 * clean?" judgement lives, and getting it wrong either rewrites the whole table
 * on every run or silently leaves personal data in place.
 *
 * Returns null when the row is already at the current rule version: the rules
 * have not changed since it was last checked, so re-filtering it can only
 * produce the same answer.
 */
export function planRowUpdate(
  row: BackfillRow,
  rules: FieldRule[],
  ruleVersion: number,
): RowUpdate | null {
  if (row.rule_version_applied === ruleVersion) return null;

  const { filtered, excludedFields } = filterPayload(
    row.raw_payload,
    rules,
    row.record_source,
  );

  // Nothing matched: the payload stands, and so does its checksum. Only the
  // stamp changes, recording that these rules were applied and found nothing.
  if (excludedFields.length === 0) {
    return {
      id: row.id,
      excluded_fields: [],
      rule_version_applied: ruleVersion,
    };
  }

  // Something was stripped, so the stored payload changes and the checksum has
  // to change with it. Leaving the old checksum would make the next ingestion
  // run compare against a payload that no longer exists and skip the record as
  // unchanged, quietly reinstating nothing — but also never repairing it.
  return {
    id: row.id,
    raw_payload: filtered,
    checksum: hashPayload(filtered),
    excluded_fields: excludedFields,
    rule_version_applied: ruleVersion,
  };
}

/**
 * Applies the active data handling rules to every existing `raw_source_records`
 * row.
 *
 * Pass `dryRun` to get the same summary without writing anything — worth doing
 * on staging before the real pass, since this rewrites stored payloads and the
 * discarded fields are not recoverable from the platform afterwards.
 */
export async function backfillDataHandlingRules(
  supabase: SupabaseClient,
  options: {
    dryRun?: boolean;
    onProgress?: (scanned: number, total: number) => void;
  } = {},
): Promise<BackfillSummary> {
  const dryRun = options.dryRun ?? false;

  // Same fail-closed stance as the runner: without the rules there is no pass to
  // make, and pretending otherwise would stamp rows as checked against nothing.
  const { data: rulesData, error: rulesError } = await supabase
    .from("data_handling_rules")
    .select("source, field_path, action")
    .eq("is_active", true);
  if (rulesError) throw rulesError;

  const { data: versionData, error: versionError } = await supabase
    .from("data_handling_rule_versions")
    .select("current_version")
    .eq("id", true)
    .single();
  if (versionError) throw versionError;

  const rules: FieldRule[] = (rulesData ?? []).map((r) => ({
    source: (r.source as string) ?? null,
    field_path: r.field_path as string,
    action: r.action as "allow" | "deny",
  }));
  const ruleVersion = (versionData?.current_version as number) ?? 0;

  const { count, error: countError } = await supabase
    .from("raw_source_records")
    .select("id", { count: "exact", head: true });
  if (countError) throw countError;
  const total = count ?? 0;

  const summary: BackfillSummary = {
    scanned: 0,
    stripped: 0,
    alreadyCurrent: 0,
    fieldCounts: {},
    ruleVersion,
    dryRun,
  };

  // Keyset pagination on the primary key rather than offset: the pass updates the
  // rows it reads, and an offset window over a table being written underneath it
  // can skip rows. `id > lastId` cannot, because id is never rewritten.
  let lastId = "00000000-0000-0000-0000-000000000000";

  for (;;) {
    const { data, error } = await supabase
      .from("raw_source_records")
      .select("id, record_source, raw_payload, rule_version_applied")
      .gt("id", lastId)
      .order("id", { ascending: true })
      .limit(BATCH_SIZE);
    if (error) throw error;

    const batch = (data ?? []) as BackfillRow[];
    if (batch.length === 0) break;

    const updates: RowUpdate[] = [];
    for (const row of batch) {
      summary.scanned++;
      const update = planRowUpdate(row, rules, ruleVersion);
      if (!update) {
        summary.alreadyCurrent++;
        continue;
      }
      if (update.excluded_fields.length > 0) {
        summary.stripped++;
        for (const path of update.excluded_fields) {
          summary.fieldCounts[path] = (summary.fieldCounts[path] ?? 0) + 1;
        }
      }
      updates.push(update);
    }

    if (!dryRun) {
      // One statement per row, not an upsert: an upsert would need every NOT NULL
      // column of raw_source_records restated, and getting one of them wrong would
      // overwrite real ingestion metadata with a default.
      for (const update of updates) {
        const { id, ...fields } = update;
        const { error: updateError } = await supabase
          .from("raw_source_records")
          .update(fields)
          .eq("id", id);
        if (updateError) throw updateError;
      }
    }

    lastId = batch[batch.length - 1].id;
    options.onProgress?.(summary.scanned, total);
  }

  if (!dryRun) {
    // One audit row for the whole pass. actor_user_id is null — audit_log
    // documents that as a system action with no end user, which this is.
    const { error: auditError } = await supabase.from("audit_log").insert({
      actor_user_id: null,
      action: "data_handling_rules_backfilled",
      target_table: "raw_source_records",
      detail: {
        rule_version: ruleVersion,
        rows_scanned: summary.scanned,
        rows_stripped: summary.stripped,
        rows_already_current: summary.alreadyCurrent,
        fields_stripped: summary.fieldCounts,
        origin: "backfill_script",
      },
    });
    if (auditError) throw auditError;
  }

  return summary;
}
