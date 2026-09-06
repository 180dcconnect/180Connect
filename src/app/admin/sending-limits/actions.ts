"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { actorFailureMessage, getCurrentActor } from "@/lib/auth/actor";
import { reportError } from "@/lib/error-logging";
import { createClient } from "@/lib/supabase/server";
import { boundedInt, safeValidate } from "@/lib/validation";

const setLimitSchema = z.object({
  limit: boundedInt(1, 100_000),
});

export type SetDailyLimitResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

/**
 * F128 AC3: the one write path for the branch-wide daily sending cap. Goes
 * through set_outreach_daily_send_limit (20260901120000) rather than a
 * direct table update — the RPC re-checks admin itself and writes the
 * audit_log row in the same transaction (docs/audit-log-pattern.md).
 */
export async function setOutreachDailySendLimit(input: unknown): Promise<SetDailyLimitResult> {
  const parsed = safeValidate(setLimitSchema, input);
  if (!parsed.success) {
    return {
      ok: false,
      message: Object.values(parsed.fieldErrors).flat().find(Boolean) ?? "Enter a valid daily limit.",
    };
  }

  const authorization = await getCurrentActor("platform-settings:manage", {
    route: "/admin/sending-limits",
  });
  if (!authorization.ok) {
    return { ok: false, message: actorFailureMessage(authorization.reason) };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_outreach_daily_send_limit", { p_limit: parsed.data.limit });
  if (error) {
    await reportError(error, { operation: "admin.sending_limits.set" });
    return { ok: false, message: "The limit could not be changed. Try again." };
  }

  revalidatePath("/admin/sending-limits");
  return { ok: true, message: `Daily sending limit set to ${parsed.data.limit}.` };
}
