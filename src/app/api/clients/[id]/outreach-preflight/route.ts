import { NextResponse } from "next/server";
import { z } from "zod";
import { actorFailureMessage, getCurrentActor } from "@/lib/auth/actor";
import { reportError } from "@/lib/error-logging";
import { logSecurityEvent } from "@/lib/log-security-event";
import {
  checkSuppressionBeforeSend,
  suppressionBlockedMessage,
  type ActiveSuppression,
} from "@/lib/outreach/suppression-check";
import { createClient } from "@/lib/supabase/server";

function denied(reason: Parameters<typeof actorFailureMessage>[0]) {
  return NextResponse.json(
    { allowed: false, error: actorFailureMessage(reason) },
    { status: reason === "unauthenticated" ? 401 : 403 },
  );
}

/**
 * F249 preflight. F123 must call checkSuppressionBeforeSend again immediately before
 * provider delivery; the outreach_messages RLS policy remains the final backstop.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const authorization = await getCurrentActor("client:contact", {
    route: "/api/clients/[id]/outreach-preflight",
  });
  if (!authorization.ok) return denied(authorization.reason);

  const { id: organisationId } = await params;
  if (!z.uuid().safeParse(organisationId).success) {
    return NextResponse.json(
      { allowed: false, error: "That client could not be found." },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  let lookupError: unknown;
  const result = await checkSuppressionBeforeSend(organisationId, async () => {
    const { data, error } = await supabase
      .from("suppressions")
      .select("id, reason")
      .eq("organisation_id", organisationId)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<ActiveSuppression>();
    if (error) {
      lookupError = error;
      throw error;
    }
    return data;
  });

  if (!result.allowed && result.kind === "unavailable") {
    await reportError(lookupError ?? new Error("Suppression lookup failed."), {
      operation: "clients.outreach_preflight.suppression_lookup",
      organisationId,
      userId: authorization.actor.id,
    });
    return NextResponse.json(
      { allowed: false, error: "Suppression status could not be checked. Nothing was sent. Please try again." },
      { status: 503 },
    );
  }

  if (!result.allowed) {
    logSecurityEvent("outreach.suppression_blocked", {
      organisationId,
      suppressionId: result.suppressionId,
      userId: authorization.actor.id,
    });
    return NextResponse.json(
      { allowed: false, error: suppressionBlockedMessage(result.reason), reason: result.reason },
      { status: 409 },
    );
  }

  return NextResponse.json({ allowed: true });
}
