import { NextResponse } from "next/server";
import { z } from "zod";

import { actorFailureMessage, getCurrentActor } from "@/lib/auth/actor";
import { reportError } from "@/lib/error-logging";
import { logSecurityEvent } from "@/lib/log-security-event";
import { checkOwnershipConflict } from "@/lib/outreach/ownership-conflict";
import {
  checkSuppressionBeforeSend,
  suppressionBlockedMessage,
  type ActiveSuppression,
} from "@/lib/outreach/suppression-check";
import { createClient } from "@/lib/supabase/server";

/**
 * An empty draft row, for a CAM who would rather write the email themselves.
 *
 * "Draft manually" needs somewhere to save to. EmailReviewPanel — the one
 * component allowed to render the approval control, and therefore the only way
 * to send — works on an outreach_messages row: it saves, sends, schedules and
 * discards by `messageId`. So a hand-written email needs a row for exactly the
 * same reason a generated one does, and this is the stage-one route with the
 * Gemini call taken out.
 *
 * What it keeps from stage-one is every gate: `client:contact`, the ownership
 * conflict check and the suppression check, all re-run here rather than trusted
 * from the client's own preflight, because a suppression or an ownership change
 * can land between the two. RLS's `can_contact_organisation` WITH CHECK is
 * still the backstop under the insert.
 *
 * What it drops is the `ai_generations` audit row: nothing was generated, and
 * writing a generation record for a human-typed email would put a cost and a
 * model name against work no model did.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const authorization = await getCurrentActor("client:contact", { route: "/clients/[id]" });
  if (!authorization.ok) {
    return NextResponse.json(
      { error: actorFailureMessage(authorization.reason) },
      { status: authorization.reason === "unauthenticated" ? 401 : 403 },
    );
  }

  const { id: organisationId } = await params;
  if (!z.uuid().safeParse(organisationId).success) {
    return NextResponse.json({ error: "That client could not be found." }, { status: 400 });
  }

  const supabase = await createClient();

  const { data: organisation, error: organisationError } = await supabase
    .from("organisations")
    .select("id, owner_id, contact_email, owner:users!organisations_owner_id_fkey(full_name)")
    .eq("id", organisationId)
    .maybeSingle<{
      id: string;
      owner_id: string | null;
      contact_email: string | null;
      owner: { full_name: string | null } | null;
    }>();
  if (organisationError || !organisation) {
    if (organisationError) {
      await reportError(organisationError, {
        operation: "outreach.blank_draft.load_client",
        organisationId,
      });
    }
    return NextResponse.json(
      { error: "That client could not be loaded." },
      { status: organisation ? 500 : 404 },
    );
  }

  const conflict = checkOwnershipConflict({
    ownerId: organisation.owner_id,
    ownerName: organisation.owner?.full_name,
    actorId: authorization.actor.id,
    actorRole: authorization.actor.role,
  });
  if (conflict.hasConflict) {
    logSecurityEvent("outreach.ownership_conflict_blocked", {
      operation: "outreach.blank_draft",
      organisationId,
      ownerId: conflict.ownerId,
      userId: authorization.actor.id,
    });
    return NextResponse.json(
      { error: conflict.warning, kind: "ownership_conflict" },
      { status: 409 },
    );
  }

  let suppressionLookupError: unknown;
  const suppressionResult = await checkSuppressionBeforeSend(organisationId, async () => {
    const { data, error } = await supabase
      .from("suppressions")
      .select("id, reason")
      .eq("organisation_id", organisationId)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<ActiveSuppression>();
    if (error) {
      suppressionLookupError = error;
      throw error;
    }
    return data;
  });
  if (!suppressionResult.allowed && suppressionResult.kind === "unavailable") {
    await reportError(suppressionLookupError ?? new Error("Suppression lookup failed."), {
      operation: "outreach.blank_draft.suppression_lookup",
      organisationId,
    });
    return NextResponse.json(
      { error: "Suppression status could not be checked. Nothing was created. Please try again." },
      { status: 503 },
    );
  }
  if (!suppressionResult.allowed) {
    logSecurityEvent("outreach.suppression_blocked", {
      operation: "outreach.blank_draft",
      organisationId,
      suppressionId: suppressionResult.suppressionId,
      userId: authorization.actor.id,
    });
    return NextResponse.json(
      {
        error: suppressionBlockedMessage(suppressionResult.reason),
        reason: suppressionResult.reason,
      },
      { status: 409 },
    );
  }

  const { data: contact } = await supabase
    .from("contacts")
    .select("id, email")
    .eq("organisation_id", organisationId)
    .order("is_primary", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle<{ id: string; email: string | null }>();

  // Empty subject and body: this is a blank page, and the review panel's own
  // validation is what refuses to send one. Pre-filling either would be putting
  // words in the CAM's mouth on a draft they asked to write themselves.
  const { data: message, error: draftError } = await supabase
    .from("outreach_messages")
    .insert({
      organisation_id: organisationId,
      contact_id: contact?.id ?? null,
      sent_by_user_id: authorization.actor.id,
      subject: "",
      body: "",
      send_status: "draft",
    })
    .select("id")
    .single();
  if (draftError || !message) {
    await reportError(draftError ?? new Error("Blank draft insert returned no row."), {
      operation: "outreach.blank_draft.save_draft",
      organisationId,
    });
    return NextResponse.json(
      { error: "The draft could not be created. Try again." },
      { status: 500 },
    );
  }

  // Same shape the stage-one route returns, so the card can hand either to
  // EmailReviewPanel without caring which made it.
  return NextResponse.json({
    id: message.id,
    subject: "",
    body: "",
    recipientOnFile: contact?.email?.trim() || organisation.contact_email?.trim() || null,
  });
}
