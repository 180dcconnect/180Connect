/**
 * One-off catch-up for public.field_sources (F044) — per-field provenance for
 * organisations that predate tracking, or whose fields were written by paths
 * that recorded nothing before 20260914110000.
 *
 *     npm run backfill:field-sources              # dry run: prints counts, writes nothing
 *     npm run backfill:field-sources -- --apply   # writes
 *
 * WHY A BACKFILL: the ingestion pipeline attributes new organisations on insert
 * (write-organisations.ts → record_field_sources) and 20260914110000 wires the
 * manual paths — but organisations created earlier have an empty provenance
 * story. The Activity tab's "What came from where" card and the Data Sources
 * card's Manual Input row both read field_sources, so a pre-tracking record
 * shows neither. This script reconstructs what CAN be proven from evidence
 * already on disk — it never guesses.
 *
 * EVIDENCE, IN PRIORITY ORDER PER FIELD (first match wins):
 *
 *   1. The raw_source_records row whose promotion created the organisation
 *      (processing_status = 'validated', matched_organisation_id = this org —
 *      the exact row insertOrganisationAndLink consumed). Its fields are
 *      RE-DERIVED through the same standardize mapper the pipeline ran, never
 *      re-guessed, and attributed with the register's name and the record's
 *      received_at. charity_commission_bulk folds to 'charity_commission'
 *      (bulk is a raw-layer dedup identity, not a provenance identity — the
 *      source CHECK has no bulk value).
 *   2. An approved manual entry converted into this organisation — attributed
 *      only when the organisation is entry_method = 'manual' (create_new). A
 *      link_existing approval attached typed values to an organisation whose
 *      fields came from a register; calling that "manual" would be a lie about
 *      who supplied the data. Values are attributed to the CAM who typed them
 *      (submitted_by_user_id) at the approval time.
 *   3. Legacy audit rows that wrote a tracked field before the RPCs existed:
 *      edit_suggestion_approved (detail.field / detail.to), and
 *      field_discrepancy_resolved / field_discrepancy_auto_resolved (their
 *      detail carries the field, the winning value and — via the
 *      field_discrepancies row or the detail itself — which register's side
 *      won). Attributed to the acting admin, source = the winning register.
 *
 * THE MATCH RULE: a field is attributed only when the evidence's value equals
 * the LIVE organisations column for that field. A raw record whose mapped
 * value no longer matches (the field was corrected after import) is NOT the
 * origin of the current value — if a legacy audit row explains the current
 * value instead, that wins; otherwise the field is left honest and empty and
 * history starts from its next real write. organisation_type is attributed
 * whenever the mapper derives one and it matches (every mapper derives it
 * deterministically); text fields are attributed only when the source actually
 * provided a value (empty is not a provenance fact).
 *
 * IDEMPOTENT BY SCOPE, NOT BY MARKER: a field is skipped when the organisation
 * already has ANY field_sources row for it — this script only ever fills a
 * field with no provenance at all, so a re-run (or a run after the pipeline
 * has started writing normally) is a no-op for everything already covered,
 * and the script can never contradict a row the real write paths recorded.
 * The trade-off, stated plainly: superseded values are NOT fabricated — an
 * organisation whose name changed twice before tracking gets one row for the
 * current value, not the history. Real superseded history accumulates from
 * the first post-migration write onwards.
 *
 * WRITES go as direct INSERTs (the postgres connection bypasses RLS) inside
 * one transaction per organisation: flip any current row to is_current=false
 * (a no-op for the empty fields this script targets, but it keeps the write
 * shape identical to record_field_source's flip-and-insert) and insert the
 * new current row. The field_sources_current_idx partial unique index is the
 * backstop.
 *
 * Reuses the seed config guard (F233) so pointing it at production refuses
 * loudly.
 */

import { reportError } from "../src/lib/error-logging.ts";
import {
  DB_URL_VAR,
  SeedConfigError,
  SeedRefusedError,
  resolveSeedConfig,
} from "../src/lib/seed/config.ts";
import {
  standardizeCharityCommissionRecord,
  type RawCharityCommissionRecord,
} from "../src/lib/standardize/charity-commission.ts";
import {
  standardizeCompaniesHouseRecord,
  type RawCompaniesHouseRecord,
} from "../src/lib/standardize/companies-house.ts";
import {
  standardizeCharityCommissionBulkRecord,
  type RawCharityCommissionBulkRecord,
} from "../src/lib/standardize/charity-commission-bulk.ts";
import {
  standardizeFindThatCharityRecord,
  type RawFindThatCharityRecord,
} from "../src/lib/standardize/find-that-charity.ts";
import {
  standardizeThreeSixtyGivingOrganisationRecord,
  type RawThreeSixtyGivingOrganisationRecord,
} from "../src/lib/standardize/three-sixty-giving-organisation.ts";
import pg from "pg";

/** The seven tracked fields — the widened CHECK on field_sources. */
const TRACKED_FIELDS = [
  "legal_name",
  "website",
  "contact_email",
  "address_line_1",
  "city",
  "postcode",
  "organisation_type",
] as const;

type TrackedField = (typeof TRACKED_FIELDS)[number];

/** One attribution candidate, before the match rule and precedence run. */
type Candidate = {
  field: TrackedField;
  value: string;
  source: string;
  recordedBy: string | null;
  recordedAt: Date;
  rawSourceRecordId: string | null;
  /** Which evidence stream produced it, for the dry-run report. */
  stream: "raw" | "manual" | "audit";
};

type LiveValues = Record<TrackedField, string | null>;

const APPLY = process.argv.includes("--apply");

/** Non-fatal per-record problems, counted and printed instead of aborting the run. */
const problems: string[] = [];
function noteProblem(message: string): void {
  if (problems.length < 40) problems.push(message);
}

/** The mappers' own derivation, per record_source. Null = no mapper for this source. */
function deriveFields(
  recordSource: string,
  payload: unknown,
): Partial<Record<TrackedField, string>> | null {
  try {
    if (recordSource === "charity_commission") {
      const org = standardizeCharityCommissionRecord(payload as RawCharityCommissionRecord);
      return pickDerived(org);
    }
    if (recordSource === "charity_commission_bulk") {
      const org = standardizeCharityCommissionBulkRecord(payload as RawCharityCommissionBulkRecord);
      return pickDerived(org);
    }
    if (recordSource === "companies_house") {
      const org = standardizeCompaniesHouseRecord(payload as RawCompaniesHouseRecord);
      return pickDerived(org);
    }
    if (recordSource === "find_that_charity") {
      const org = standardizeFindThatCharityRecord(payload as RawFindThatCharityRecord);
      return pickDerived(org);
    }
    if (recordSource === "360giving") {
      const org = standardizeThreeSixtyGivingOrganisationRecord(
        payload as RawThreeSixtyGivingOrganisationRecord,
      );
      return pickDerived(org);
    }
    return null;
  } catch (error) {
    noteProblem(
      `mapper threw for a ${recordSource} payload: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

/** The tracked subset of a mapper's output. organisation_type is always meaningful. */
function pickDerived(
  org: ReturnType<typeof standardizeCharityCommissionRecord>,
): Partial<Record<TrackedField, string>> {
  const out: Partial<Record<TrackedField, string>> = {};
  for (const field of TRACKED_FIELDS) {
    const value = org[field];
    if (typeof value === "string" && value.trim()) out[field] = value.trim();
  }
  return out;
}

async function main(): Promise<void> {
  const config = resolveSeedConfig(process.env);
  console.log(
    `[backfill:field-sources] target: ${config.target}${APPLY ? " (APPLY)" : " (dry run — pass --apply to write)"}`,
  );

  const client = new pg.Client({ connectionString: config.databaseUrl });
  await client.connect();

  try {
    // Refuse to half-run against a database still on the six-field CHECK: every
    // organisation_type row this script writes would be rejected mid-pass.
    const constraint = await client.query<{ def: string }>(
      `select pg_get_constraintdef(oid) as def from pg_constraint
        where conrelid = 'public.field_sources'::regclass and contype = 'c'
          and pg_get_constraintdef(oid) like '%field_name%'`,
    );
    if (!constraint.rows.some((row) => row.def.includes("organisation_type"))) {
      throw new SeedConfigError(
        "public.field_sources is still on the six-field CHECK — apply migration " +
          "20260914110000 (extend_field_sources_and_manual_provenance) before backfilling.",
      );
    }

    const { rows: organisations } = await client.query<{
      id: string;
      entry_method: string;
    }>(
      `select id, entry_method::text as entry_method
         from public.organisations
        where not is_seed
        order by created_at, id`,
    );
    console.log(
      `[backfill:field-sources] ${organisations.length} organisations in scope (is_seed excluded).`,
    );

    let orgsTouched = 0;
    let rowsPlanned = 0;
    let rowsWritten = 0;
    let fieldsSkippedCovered = 0;
    let fieldsSkippedNoEvidence = 0;
    let fieldsSkippedValueDrift = 0;
    const byStream = { raw: 0, manual: 0, audit: 0 };
    const byField = new Map<string, number>();
    const bySource = new Map<string, number>();
    const samples: string[] = [];

    for (const org of organisations) {
      // ---- What the record says NOW, per tracked field. ----
      const { rows: liveRows } = await client.query<{
        legal_name: string;
        website: string | null;
        contact_email: string | null;
        address_line_1: string | null;
        city: string | null;
        postcode: string | null;
        organisation_type: string | null;
      }>(
        `select legal_name, website, contact_email, address_line_1, city, postcode,
                organisation_type::text as organisation_type
           from public.organisations where id = $1`,
        [org.id],
      );
      const liveRow = liveRows[0];
      const live: LiveValues = {
        legal_name: liveRow.legal_name,
        website: liveRow.website,
        contact_email: liveRow.contact_email,
        address_line_1: liveRow.address_line_1,
        city: liveRow.city,
        postcode: liveRow.postcode,
        organisation_type: liveRow.organisation_type,
      };

      // ---- Idempotency by scope: fields already carrying ANY provenance row ----
      // (current or superseded) are the real write paths' territory now.
      const { rows: coveredRows } = await client.query<{ field_name: string }>(
        `select distinct field_name from public.field_sources where organisation_id = $1`,
        [org.id],
      );
      const covered = new Set(coveredRows.map((row) => row.field_name));

      // ---- Evidence candidates, then precedence: raw > manual > audit. ----
      const winners = new Map<TrackedField, Candidate>();
      const consider = (candidate: Candidate) => {
        if (winners.has(candidate.field)) return;
        const liveValue = live[candidate.field];
        // The match rule: evidence explains the CURRENT value or it explains nothing.
        if (liveValue === null || liveValue.trim() === "") return;
        if (candidate.value !== liveValue.trim()) {
          fieldsSkippedValueDrift += 1;
          return;
        }
        winners.set(candidate.field, candidate);
      };

      // Stream 1 — the validated raw record whose promotion created this org.
      const { rows: raws } = await client.query<{
        id: string;
        record_source: string;
        received_at: Date;
        raw_payload: unknown;
      }>(
        `select id, record_source::text as record_source, received_at, raw_payload
           from public.raw_source_records
          where matched_organisation_id = $1
            and processing_status = 'validated'
          order by received_at desc`,
        [org.id],
      );
      for (const raw of raws) {
        const derived = deriveFields(raw.record_source, raw.raw_payload);
        if (!derived) continue;
        // The bulk extract attributes as the register itself, not its dedup identity.
        const source = raw.record_source === "charity_commission_bulk"
          ? "charity_commission"
          : raw.record_source;
        for (const [field, value] of Object.entries(derived)) {
          consider({
            field: field as TrackedField,
            value,
            source,
            recordedBy: null,
            recordedAt: raw.received_at,
            rawSourceRecordId: raw.id,
            stream: "raw",
          });
        }
      }

      // Stream 2 — the CAM-typed entry that became this organisation.
      // entry_method = 'manual' is the create_new gate: a link_existing approval
      // must not overwrite the register attribution of the org it linked to.
      if (org.entry_method === "manual") {
        const { rows: entries } = await client.query<{
          id: string;
          submitted_by_user_id: string;
          approved_at: Date | null;
          created_at: Date;
          legal_name: string | null;
          website: string | null;
          contact_email: string | null;
          address_line_1: string | null;
          city: string | null;
          postcode: string | null;
          organisation_type: string | null;
        }>(
          `select id, submitted_by_user_id, reviewed_at as approved_at, created_at,
                  legal_name, website, contact_email, address_line_1, city, postcode,
                  organisation_type::text as organisation_type
             from public.manual_entry_records
            where converted_to_organisation_id = $1
              and review_status = 'approved'
            order by reviewed_at asc nulls last`,
          [org.id],
        );
        for (const entry of entries) {
          const at = entry.approved_at ?? entry.created_at;
          const fields: [TrackedField, string | null][] = [
            ["legal_name", entry.legal_name],
            ["website", entry.website],
            ["contact_email", entry.contact_email],
            ["address_line_1", entry.address_line_1],
            ["city", entry.city],
            ["postcode", entry.postcode],
            ["organisation_type", entry.organisation_type],
          ];
          for (const [field, value] of fields) {
            const trimmed = (value ?? "").trim();
            if (!trimmed) continue;
            consider({
              field,
              value: trimmed,
              source: "manual",
              recordedBy: entry.submitted_by_user_id,
              recordedAt: at,
              rawSourceRecordId: null,
              stream: "manual",
            });
          }
        }
      }

      // Stream 3 — legacy audit rows that wrote a tracked field before the
      // provenance RPCs existed. These usually explain a value the import raw
      // no longer matches (a post-import correction), which is why they run last.
      const { rows: audits } = await client.query<{
        id: string;
        actor_user_id: string | null;
        created_at: Date;
        action: string;
        detail: Record<string, unknown> | null;
      }>(
        `select id, actor_user_id, created_at, action, detail
           from public.audit_log
          where target_table = 'organisations'
            and target_id = $1
            and action in ('edit_suggestion_approved', 'field_discrepancy_resolved',
                           'field_discrepancy_auto_resolved')
          order by created_at asc`,
        [org.id],
      );
      for (const audit of audits) {
        const detail = audit.detail ?? {};
        const field = typeof detail.field === "string"
          ? detail.field
          : typeof detail.field_name === "string"
            ? detail.field_name
            : null;
        const value = typeof detail.to === "string"
          ? detail.to
          : typeof detail.value === "string"
            ? detail.value
            : null;
        if (!field || !value?.trim()) continue;
        if (!TRACKED_FIELDS.includes(field as TrackedField)) continue;

        let source: string | null = null;
        if (audit.action === "edit_suggestion_approved") {
          // A person corrected the field; the register attribution is superseded.
          source = "manual";
        } else {
          // Which register's side won is the whole point of the attribution.
          // auto_resolved carries both sources in its detail; a manual
          // resolution only carries the choice, so the discrepancy row is read.
          const existing = typeof detail.existing_source === "string"
            ? detail.existing_source
            : null;
          const incoming = typeof detail.incoming_source === "string"
            ? detail.incoming_source
            : null;
          const choice = detail.choice === "existing" || detail.choice === "incoming"
            ? detail.choice
            : null;
          if (choice === "existing" && existing) source = existing;
          else if (choice === "incoming" && incoming) source = incoming;
          else if (typeof detail.field_discrepancy_id === "string") {
            const { rows: disc } = await client.query<{
              existing_source: string | null;
              incoming_source: string | null;
            }>(
              `select existing_source::text as existing_source,
                      incoming_source::text as incoming_source
                 from public.field_discrepancies
                where id = $1::uuid`,
              [detail.field_discrepancy_id],
            );
            if (disc[0]) {
              source = choice === "incoming"
                ? disc[0].incoming_source
                : choice === "existing"
                  ? disc[0].existing_source
                  : null;
            }
          }
        }
        if (!source) continue;

        consider({
          field: field as TrackedField,
          value: value.trim(),
          source,
          recordedBy: audit.actor_user_id,
          recordedAt: audit.created_at,
          rawSourceRecordId: null,
          stream: "audit",
        });
      }

      // ---- Write what survived, skip what didn't. ----
      const toWrite = [...winners.values()].filter((c) => !covered.has(c.field));
      for (const field of TRACKED_FIELDS) {
        if (covered.has(field)) fieldsSkippedCovered += 1;
        else if (!winners.has(field)) fieldsSkippedNoEvidence += 1;
        // winners.has(field) but value drifted was counted inside consider().
      }

      if (toWrite.length === 0) continue;
      orgsTouched += 1;
      for (const candidate of toWrite) {
        rowsPlanned += 1;
        byStream[candidate.stream] += 1;
        byField.set(candidate.field, (byField.get(candidate.field) ?? 0) + 1);
        bySource.set(candidate.source, (bySource.get(candidate.source) ?? 0) + 1);
        if (samples.length < 10) {
          samples.push(
            `${candidate.field}="${candidate.value.slice(0, 40)}" ← ${candidate.source}` +
              `${candidate.recordedBy ? " (by user " + candidate.recordedBy.slice(0, 8) + "…)" : ""}` +
              ` [${candidate.stream}]`,
          );
        }
      }

      if (!APPLY) continue;

      // One transaction per organisation: flip + insert, backstopped by
      // field_sources_current_idx, identical in shape to record_field_source.
      await client.query("begin");
      try {
        for (const candidate of toWrite) {
          await client.query(
            `update public.field_sources
                set is_current = false
              where organisation_id = $1 and field_name = $2 and is_current`,
            [org.id, candidate.field],
          );
          await client.query(
            `insert into public.field_sources (
               organisation_id, field_name, value, source, raw_source_record_id,
               recorded_by, recorded_at, is_current
             ) values ($1, $2, $3, $4, $5, $6, $7, true)`,
            [
              org.id,
              candidate.field,
              candidate.value,
              candidate.source,
              candidate.rawSourceRecordId,
              candidate.recordedBy,
              candidate.recordedAt,
            ],
          );
          rowsWritten += 1;
        }
        await client.query("commit");
        // Silent until the summary: per-org progress on tens of thousands of
        // organisations would drown the numbers that matter.
      } catch (error) {
        await client.query("rollback");
        throw error;
      }
    }

    console.log(
      `[backfill:field-sources] ${APPLY ? "wrote" : "would write"} ${rowsPlanned} rows across ${orgsTouched} organisations.` +
        (APPLY && rowsWritten !== rowsPlanned ? ` (${rowsPlanned - rowsWritten} failed mid-pass)` : ""),
    );
    console.log(
      `[backfill:field-sources] by evidence stream: raw=${byStream.raw}, manual=${byStream.manual}, audit=${byStream.audit}`,
    );
    console.log(
      `[backfill:field-sources] by source: ` +
        [...bySource.entries()].map(([s, c]) => `${s}=${c}`).join(", "),
    );
    console.log(
      `[backfill:field-sources] by field: ` +
        [...byField.entries()].map(([f, c]) => `${f}=${c}`).join(", "),
    );
    console.log(
      `[backfill:field-sources] skipped: ${fieldsSkippedCovered} already covered by real provenance, ` +
        `${fieldsSkippedNoEvidence} with no on-disk evidence, ` +
        `${fieldsSkippedValueDrift} evidence-vs-live mismatches (corrected after import — left honest).`,
    );
    if (samples.length > 0) {
      console.log(`[backfill:field-sources] sample attributions:`);
      for (const sample of samples) console.log(`  - ${sample}`);
    }
    for (const problem of problems) {
      console.warn(`[backfill:field-sources] NOTE: ${problem}`);
    }
    if (!APPLY) {
      console.log("[backfill:field-sources] dry run — nothing written. Re-run with --apply.");
    }
  } finally {
    await client.end();
  }
}

main().catch(async (error: unknown) => {
  if (error instanceof SeedRefusedError || error instanceof SeedConfigError) {
    console.error(`\n[backfill:field-sources] ${error.message}\n`);
    if (error instanceof SeedConfigError) {
      await reportError(error, { script: "backfill-field-sources", env: DB_URL_VAR });
    }
    process.exit(1);
  }
  console.error("\n[backfill:field-sources] failed.");
  console.error(error);
  await reportError(error instanceof Error ? error : new Error(String(error)), {
    script: "backfill-field-sources",
    env: DB_URL_VAR,
  });
  process.exit(1);
});
