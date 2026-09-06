"use server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentActor } from "@/lib/auth/actor";
import { reportError } from "@/lib/error-logging";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RuleRow = {
  id: string;
  rule_version: number;
  source: string | null;
  field_path: string;
  action: "allow" | "deny";
  reason: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  created_by_user: { full_name: string | null; email: string } | null;
};

export type ActionResult =
  | { ok: true; message: string }
  | { ok: false; error: string };

/** What the rules have actually stripped, per field path. */
export type FilterSummaryRow = {
  field_path: string;
  records_affected: number;
  last_applied: string | null;
};

export type FilterActivity = {
  recordsTotal: number;
  recordsChecked: number;
  recordsStripped: number;
  fields: FilterSummaryRow[];
  error?: string;
};

/**
 * Turns a Postgres error into something an admin can act on.
 *
 * The RPCs raise plain messages that are already written for a person, so those
 * pass through. The constraint violations do not: a unique-violation surfaces as
 * `duplicate key value violates unique constraint "data_handling_rules_active_unique"`,
 * which tells the reader nothing about what to do differently.
 */
function friendlyError(error: { code?: string; message: string }): string {
  if (error.code === "23505") {
    return (
      "An active rule already covers that source and field path. " +
      "Deactivate the existing rule before adding a different one for the same field."
    );
  }
  if (error.code === "22P02") {
    return "That source is not one the platform ingests from.";
  }
  if (error.code === "23514") {
    return "That is not a valid action — a rule must either allow or deny.";
  }
  // P0001 is a raise from inside our own RPCs, whose messages are already
  // written to be read by a person ("Only admins can create data handling rules").
  return error.message;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function loadRules(): Promise<{
  rules: RuleRow[];
  version: number;
  error?: string;
}> {
  const authorization = await getCurrentActor("user:manage", {
    route: "/admin/data-handling-rules",
  });
  if (!authorization.ok) {
    return { rules: [], version: 0, error: "Not authorised." };
  }

  const supabase = await createClient();

  const [rulesResult, versionResult] = await Promise.all([
    supabase
      .from("data_handling_rules")
      .select(
        "id, rule_version, source, field_path, action, reason, is_active, created_at, updated_at, created_by_user:users!created_by(full_name, email)",
      )
      .order("is_active", { ascending: false })
      .order("created_at", { ascending: false }),
    supabase
      .from("data_handling_rule_versions")
      .select("current_version")
      .eq("id", true)
      .single(),
  ]);

  if (rulesResult.error) {
    await reportError(rulesResult.error, {
      operation: "admin.data_handling_rules.load",
    });
    return { rules: [], version: 0, error: "Could not load rules." };
  }
  if (versionResult.error) {
    await reportError(versionResult.error, {
      operation: "admin.data_handling_rules.load_version",
    });
  }

  return {
    rules: (rulesResult.data ?? []) as unknown as RuleRow[],
    version: (versionResult.data?.current_version as number) ?? 0,
  };
}

/**
 * What the rules have actually done to stored data.
 *
 * The rules table says what the platform intends to exclude; this says what it
 * has excluded. Without it an admin cannot tell a rule that strips hundreds of
 * records a week from one whose field path has a typo in it and has never
 * matched anything.
 */
export async function loadFilterActivity(): Promise<FilterActivity> {
  const empty: FilterActivity = {
    recordsTotal: 0,
    recordsChecked: 0,
    recordsStripped: 0,
    fields: [],
  };

  const authorization = await getCurrentActor("user:manage", {
    route: "/admin/data-handling-rules",
  });
  if (!authorization.ok) return { ...empty, error: "Not authorised." };

  const supabase = await createClient();

  const [coverageResult, summaryResult] = await Promise.all([
    supabase.rpc("data_handling_coverage"),
    supabase.rpc("data_handling_filter_summary"),
  ]);

  if (coverageResult.error || summaryResult.error) {
    await reportError(coverageResult.error ?? summaryResult.error, {
      operation: "admin.data_handling_rules.load_activity",
    });
    // The rules themselves still render — this panel is reporting, not control.
    return { ...empty, error: "Could not load filtering activity." };
  }

  const coverage = (coverageResult.data ?? [])[0] as
    | {
        records_total: number;
        records_checked: number;
        records_stripped: number;
      }
    | undefined;

  return {
    recordsTotal: Number(coverage?.records_total ?? 0),
    recordsChecked: Number(coverage?.records_checked ?? 0),
    recordsStripped: Number(coverage?.records_stripped ?? 0),
    fields: (summaryResult.data ?? []).map(
      (row: {
        field_path: string;
        records_affected: number;
        last_applied: string | null;
      }) => ({
        field_path: row.field_path,
        records_affected: Number(row.records_affected),
        last_applied: row.last_applied,
      }),
    ),
  };
}

// ---------------------------------------------------------------------------
// Writes — call RPCs, which handle auth + audit internally
// ---------------------------------------------------------------------------

export async function createRule(formData: FormData): Promise<ActionResult> {
  const authorization = await getCurrentActor("user:manage", {
    route: "/admin/data-handling-rules",
  });
  if (!authorization.ok) {
    return { ok: false, error: "Not authorised." };
  }

  const source = formData.get("source") as string | null;
  const fieldPath = formData.get("field_path") as string | null;
  const action = formData.get("action") as string | null;
  const reason = formData.get("reason") as string | null;

  if (!fieldPath?.trim()) {
    return { ok: false, error: "Field path is required." };
  }
  if (!reason?.trim()) {
    return { ok: false, error: "Reason is required." };
  }

  const supabase = await createClient();

  const { error } = await supabase.rpc("create_data_handling_rule", {
    p_source: source || null,
    p_field_path: fieldPath.trim(),
    p_action: action || "deny",
    p_reason: reason.trim(),
  });

  if (error) {
    await reportError(error, {
      operation: "admin.data_handling_rules.create",
    });
    return { ok: false, error: friendlyError(error) };
  }

  return { ok: true, message: "Rule created." };
}

export async function toggleRuleActive(
  ruleId: string,
  isActive: boolean,
  reason?: string,
): Promise<ActionResult> {
  const authorization = await getCurrentActor("user:manage", {
    route: "/admin/data-handling-rules",
  });
  if (!authorization.ok) {
    return { ok: false, error: "Not authorised." };
  }

  const supabase = await createClient();

  const { error } = await supabase.rpc("set_data_handling_rule_active", {
    p_rule_id: ruleId,
    p_is_active: isActive,
    p_reason: reason || null,
  });

  if (error) {
    await reportError(error, {
      operation: "admin.data_handling_rules.toggle_active",
    });
    return { ok: false, error: friendlyError(error) };
  }

  return {
    ok: true,
    message: isActive ? "Rule reactivated." : "Rule deactivated.",
  };
}
