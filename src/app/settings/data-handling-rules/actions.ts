"use server";

import { createClient } from "@/lib/supabase/server";
import { getViewingActor, getCurrentActor } from "@/lib/auth/actor";
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
  rule_kind: "field_path" | "redact_personal_email" | "redact_phone_number";
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

const NOT_AUTHORISED = "Only admins can change these settings.";

/**
 * Turns a Postgres error into something an admin can act on.
 *
 * The people using this screen are not developers (AGENTS.md, "Who will maintain
 * this app"), so every message says what happened in the screen's own words —
 * "protection", not rule, path or constraint.
 */
function friendlyError(error: { code?: string; message: string }): string {
  if (error.code === "23505") {
    return "That protection is already on. Refresh the page to see the latest list.";
  }
  if (error.code === "22P02") {
    return "That source is not one the platform imports from.";
  }
  if (error.code === "23514") {
    return "That combination is not allowed. Check the developer settings and try again.";
  }
  if (/not found/i.test(error.message)) {
    return "That protection no longer exists. Refresh the page to see the latest list.";
  }
  if (/admin/i.test(error.message)) {
    return NOT_AUTHORISED;
  }
  return "The change could not be saved. Refresh the page and try again.";
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function loadRules(): Promise<{
  rules: RuleRow[];
  version: number;
  error?: string;
}> {
  const authorization = await getViewingActor("user:manage", {
    route: "/settings/data-handling-rules",
  });
  if (!authorization.ok) {
    return { rules: [], version: 0, error: NOT_AUTHORISED };
  }

  const supabase = await createClient();

  const [rulesResult, versionResult] = await Promise.all([
    supabase
      .from("data_handling_rules")
      .select(
        "id, rule_version, source, field_path, action, rule_kind, reason, is_active, created_at, updated_at, created_by_user:users!created_by(full_name, email)",
      )
      // No active-first ordering: a protection that is turned off must stay
      // where it is in the list, so the order cannot depend on the toggle.
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
    return { rules: [], version: 0, error: "The protections could not be loaded." };
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
 * The rules list says what the platform intends to keep out; this says what it
 * has kept out. Without it an admin cannot tell a protection that removes
 * hundreds of records a week from one that has never matched anything.
 */
export async function loadFilterActivity(): Promise<FilterActivity> {
  const empty: FilterActivity = {
    recordsTotal: 0,
    recordsChecked: 0,
    recordsStripped: 0,
    fields: [],
  };

  const authorization = await getViewingActor("user:manage", {
    route: "/settings/data-handling-rules",
  });
  if (!authorization.ok) return { ...empty, error: NOT_AUTHORISED };

  const supabase = await createClient();

  const [coverageResult, summaryResult] = await Promise.all([
    supabase.rpc("data_handling_coverage"),
    supabase.rpc("data_handling_filter_summary"),
  ]);

  if (coverageResult.error || summaryResult.error) {
    await reportError(coverageResult.error ?? summaryResult.error, {
      operation: "admin.data_handling_rules.load_activity",
    });
    // The protections themselves still render — this panel is reporting, not control.
    return { ...empty, error: "What has been removed so far could not be loaded. Refresh the page to try again." };
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

export type ObservedField = {
  field_path: string;
  records_seen: number;
  records_sampled: number;
};

/**
 * The field names a source has really sent, from its most recent stored records
 * (`data_handling_observed_fields`). Loaded when an admin opens the picker for a
 * source rather than on page load — it walks stored payloads and is the slowest
 * read on the screen. Names and counts only; the RPC never returns values.
 */
export async function loadObservedFields(
  source: string,
): Promise<{ fields: ObservedField[]; error?: string }> {
  const authorization = await getViewingActor("user:manage", {
    route: "/settings/data-handling-rules",
  });
  if (!authorization.ok) return { fields: [], error: NOT_AUTHORISED };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("data_handling_observed_fields", {
    p_source: source,
  });

  if (error) {
    await reportError(error, {
      operation: "admin.data_handling_rules.observed_fields",
    });
    // PGRST202: the function is not in the database yet — its migration has not
    // been deployed to this environment. Retrying cannot fix that, so say who can.
    if (error.code === "PGRST202") {
      return {
        fields: [],
        error:
          "This part of the page needs a database update that has not been installed here yet. Ask a developer to deploy it; the rest of the page works as normal.",
      };
    }
    return {
      fields: [],
      error: "The fields for this source could not be loaded. Try again in a moment.",
    };
  }

  return {
    fields: ((data ?? []) as Array<{
      field_path: string;
      records_seen: number;
      records_sampled: number;
    }>).map((row) => ({
      field_path: row.field_path,
      records_seen: Number(row.records_seen),
      records_sampled: Number(row.records_sampled),
    })),
  };
}

// ---------------------------------------------------------------------------
// Writes — call RPCs, which handle auth + audit internally
// ---------------------------------------------------------------------------

const RULE_KINDS = new Set(["field_path", "redact_personal_email", "redact_phone_number"]);

export async function createRule(formData: FormData): Promise<ActionResult> {
  const authorization = await getCurrentActor("user:manage", {
    route: "/settings/data-handling-rules",
  });
  if (!authorization.ok) {
    return { ok: false, error: NOT_AUTHORISED };
  }

  const source = formData.get("source") as string | null;
  const fieldPath = formData.get("field_path") as string | null;
  const action = formData.get("action") as string | null;
  const reason = formData.get("reason") as string | null;
  const ruleKind = (formData.get("rule_kind") as string | null) || "field_path";

  if (!fieldPath?.trim()) {
    return { ok: false, error: "Enter the field to protect." };
  }
  if (!reason?.trim()) {
    return { ok: false, error: "Say why this data should be kept out." };
  }
  if (!RULE_KINDS.has(ruleKind)) {
    return { ok: false, error: "That kind of protection is not recognised." };
  }

  const supabase = await createClient();

  const { error } = await supabase.rpc("create_data_handling_rule", {
    p_source: source || null,
    p_field_path: fieldPath.trim(),
    p_action: action || "deny",
    p_reason: reason.trim(),
    p_rule_kind: ruleKind,
  });

  if (error) {
    await reportError(error, {
      operation: "admin.data_handling_rules.create",
    });
    return { ok: false, error: friendlyError(error) };
  }

  return { ok: true, message: "Protection turned on. It applies from the next import." };
}

export async function toggleRuleActive(
  ruleId: string,
  isActive: boolean,
  reason?: string,
): Promise<ActionResult> {
  const authorization = await getCurrentActor("user:manage", {
    route: "/settings/data-handling-rules",
  });
  if (!authorization.ok) {
    return { ok: false, error: NOT_AUTHORISED };
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
    message: isActive
      ? "Protection turned back on. It applies from the next import."
      : "Protection turned off. From the next import this data will be saved again — you can turn it back on below.",
  };
}
