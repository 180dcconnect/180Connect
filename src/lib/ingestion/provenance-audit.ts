// Provenance-gap audit — the scheduled counterpart to the F221 invariant that
// every client can answer "where did this come from?".
//
// The invariant is structural: every API-created organisation starts life as a
// raw_source_records row, and promotion links it back via matched_organisation_id.
// But the promote step's insert and its status update are separate calls, so a
// failure between them (or any future code path that skips the link) can leave an
// organisation with no contributing source at all — a Data Sources card that shows
// nothing, and a record whose origin no one can cite. This sweep finds exactly
// those rows and records the finding in audit_log (action 'provenance_audited'),
// where the admin audit-log page already renders and filters it with no further
// work — same trick as the stall sweep, whose "no separate state table" reasoning
// this module borrows wholesale.
//
// "No source" is not itself an error state — orgs enter manually too. The
// definition of the flagged set lives entirely in the database:
// get_unprovenanced_organisations() (20260923105000) returns API-created,
// non-seed organisations with no linked raw record. Keeping the rule in SQL means
// the audit and any ad-hoc admin query can never disagree about what counts.
//
// Runs as service_role via the admin client. EXECUTE on the RPC is granted to
// service_role only; nothing here is reachable from user sessions.

import { reportError } from "../error-logging.ts";

export type ProvenanceAuditRow = {
  organisation_id: string;
  legal_name: string;
  entry_method: string;
  created_at: string;
};

export type ProvenanceAuditResult = {
  /** Organisations the RPC returned on this run. */
  unprovenancedCount: number;
  /** True when the flagged set differs from the previous sweep's audit entry. */
  changed: boolean;
  /** Non-fatal: the audit insert failed and the change was only reported. */
  auditWriteFailed: boolean;
};

const AUDIT_ACTION = "provenance_audited";

export async function runProvenanceAudit(): Promise<ProvenanceAuditResult> {
  // Not admin.ts: this module runs in the ingestion/cron context, where the
  // server-only guard does not apply — same split as ingestion/store.ts.
  const { buildAdminClient } = await import("../supabase/admin-client-factory.ts");
  const admin = buildAdminClient();
  if (!admin) throw new Error("Provenance audit is not configured.");

  const { data, error } = await admin
    .rpc("get_unprovenanced_organisations");

  if (error) {
    await reportError(error, { operation: "provenance_audit.rpc" });
    throw error;
  }

  const rows = (data as unknown as ProvenanceAuditRow[] | null) ?? [];
  const flagged = rows;
  // Sorted so the comparison against the previous sweep is order-insensitive.
  const currentIds = flagged.map((row) => row.organisation_id).sort();

  // Previous sweep's set — read from audit_log so the comparison itself is
  // auditable and no separate state table is needed.
  const { data: latest, error: latestError } = await admin
    .from("audit_log")
    .select("detail")
    .eq("action", AUDIT_ACTION)
    .order("created_at", { ascending: false })
    .limit(1)
    .overrideTypes<Array<{ detail: { unprovenanced?: string[] } }>>();

  if (latestError) {
    await reportError(latestError, { operation: "provenance_audit.latest_audit_read" });
  }
  const previousIds = [...(latest?.[0]?.detail?.unprovenanced ?? [])].sort();
  const changed =
    currentIds.length !== previousIds.length ||
    currentIds.some((id, index) => id !== previousIds[index]);

  let auditWriteFailed = false;
  if (changed) {
    const { error: insertError } = await admin.from("audit_log").insert({
      actor_user_id: null,
      action: AUDIT_ACTION,
      target_table: "organisations",
      target_id: null,
      detail: { unprovenanced: currentIds, count: currentIds.length },
    });
    if (insertError) {
      auditWriteFailed = true;
      await reportError(insertError, { operation: "provenance_audit.audit_insert" });
    }
  }

  return {
    unprovenancedCount: currentIds.length,
    changed,
    auditWriteFailed,
  };
}
