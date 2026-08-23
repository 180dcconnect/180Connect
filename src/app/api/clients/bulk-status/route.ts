import { NextResponse } from "next/server";
import { z } from "zod";
import { actorFailureMessage, getCurrentActor } from "@/lib/auth/actor";
import { createClient } from "@/lib/supabase/server";
import { logSecurityEvent } from "@/lib/log-security-event";
import { reportError } from "@/lib/error-logging";
import { PIPELINE_STATUSES } from "@/lib/organisation-format";
import {
  MAX_BULK_STATUS_CLIENTS,
  bulkStatusSummary,
  parseBulkStatusResult,
  setOutreachStatusBulkRpcFailure,
} from "@/lib/bulk-status";

/**
 * F064 — move every selected client to one pipeline status, reached from the bulk
 * bar on /clients.
 *
 * One request, one call to set_outreach_status_bulk, one transaction. Not a loop
 * over /api/clients/[id]/status: that would be N round trips and N transactions,
 * so a failure partway through would leave the list half updated with no way for
 * the CAM to tell which half — the exact misuse risk F064 flags. The RPC is
 * SECURITY DEFINER and re-checks owner-or-admin across the whole batch, so
 * client:edit here is the same outer gate the single-client status route uses.
 */

const bodySchema = z.object({
  ids: z
    .array(z.uuid())
    // The ceiling is the database's; repeating it here turns a would-be 400 from
    // Postgres into a rejection that never leaves the app, and keeps an absurd
    // payload from being parsed and shipped to the database at all.
    .min(1)
    .max(MAX_BULK_STATUS_CLIENTS),
  status: z.enum(PIPELINE_STATUSES),
});

function denied(reason: Parameters<typeof actorFailureMessage>[0]) {
  const status = reason === "unauthenticated" ? 401 : 403;
  return NextResponse.json({ error: actorFailureMessage(reason) }, { status });
}

export async function POST(request: Request) {
  const authorization = await getCurrentActor("client:edit", { route: "/clients" });
  if (!authorization.ok) return denied(authorization.reason);

  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return NextResponse.json({ error: "The request body must be valid JSON." }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(input);
  if (!parsed.success) {
    logSecurityEvent("validation.rejected", {
      route: "/api/clients/bulk-status",
      fieldCount: parsed.error.issues.length,
    });
    return NextResponse.json(
      {
        error: `Select between 1 and ${MAX_BULK_STATUS_CLIENTS} clients and choose a valid pipeline status.`,
      },
      { status: 400 },
    );
  }

  const { ids, status } = parsed.data;
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("set_outreach_status_bulk", {
    p_organisation_ids: ids,
    p_new_status: status,
  });

  if (error) {
    await reportError(error, {
      operation: "clients.bulk_status",
      // The count, not the ids: enough to see the shape of what failed in the
      // error log without copying a list of client ids into it.
      selectedCount: ids.length,
      status,
    });
    const { status: httpStatus, error: message } = setOutreachStatusBulkRpcFailure(error);
    return NextResponse.json({ error: message }, { status: httpStatus });
  }

  const result = parseBulkStatusResult(data);
  if (!result) {
    await reportError(new Error("set_outreach_status_bulk returned an unreadable result"), {
      operation: "clients.bulk_status",
      selectedCount: ids.length,
      status,
    });
    // The write committed — the RPC only returns after its own statement — so
    // this cannot claim nothing happened. It tells the CAM to look instead.
    return NextResponse.json(
      { error: "The change was applied but could not be summarised. Refresh to see the list." },
      { status: 500 },
    );
  }

  return NextResponse.json({ ...result, message: bulkStatusSummary(result, status) }, { status: 200 });
}
