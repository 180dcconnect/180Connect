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
    return { ok: false, error: error.message };
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
    return { ok: false, error: error.message };
  }

  return {
    ok: true,
    message: isActive ? "Rule reactivated." : "Rule deactivated.",
  };
}
