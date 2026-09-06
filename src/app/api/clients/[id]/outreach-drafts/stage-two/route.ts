import { NextResponse } from "next/server";
import { z } from "zod";
import { actorFailureMessage, getCurrentActor } from "@/lib/auth/actor";
import { reportError } from "@/lib/error-logging";
import { logSecurityEvent } from "@/lib/log-security-event";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  createStageTwoModelCall,
  generateStageTwoDraft,
  isStageTwoEligible,
} from "@/lib/outreach/stage-two-generation";
import { buildStageTwoGenerationInsert } from "@/lib/outreach/stage-two-persistence";
import { emailHtmlToPlainText } from "@/lib/outreach/email-html";
import { CLOSING_APPROACHES, EMAIL_LENGTHS, EMAIL_TONES, EMAIL_VOICES } from "@/lib/outreach/stage-one-prompt";
import {
  checkSuppressionBeforeSend,
  suppressionBlockedMessage,
  type ActiveSuppression,
} from "@/lib/outreach/suppression-check";
import { checkOwnershipConflict } from "@/lib/outreach/ownership-conflict";
import { computeCostUsd } from "@/lib/outreach/generation-cost";
import { consumeAiGenerationAllowance } from "@/lib/ai/rate-limit";

export const maxDuration = 60;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
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

  // The booklet is deliberately NOT part of the request body — same decision as
  // Stage 1 (F103): the saved booklet (F085/F086) is read straight from
  // client_booklets below, so the text reaching the prompt is exactly what
  // RLS-protected storage holds, never a client-supplied string.
  const parsed = z.object({
    length: z.enum(EMAIL_LENGTHS).default("standard"),
    voice: z.enum(EMAIL_VOICES).default("180dc"),
    tone: z.enum(EMAIL_TONES).default("balanced"),
    closing: z.enum(CLOSING_APPROACHES).default("soft_cta"),
    replyEventId: z.uuid().optional(),
  }).safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Choose valid follow-up preferences and try again." }, { status: 400 });
  }

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Email generation is not configured. Contact an administrator." }, { status: 503 });
  }

  const supabase = await createClient();
  const { data: organisation, error: organisationError } = await supabase
    .from("organisations")
    .select(
      "id, legal_name, trading_name, organisation_type, website, city, country_code, geographic_reach, outreach_status, owner_id, owner:users!organisations_owner_id_fkey(full_name)",
    )
    .eq("id", organisationId)
    .maybeSingle<{
      id: string;
      legal_name: string;
      trading_name: string | null;
      organisation_type: string;
      website: string | null;
      city: string | null;
      country_code: string | null;
      geographic_reach: string | null;
      outreach_status: string;
      owner_id: string | null;
      owner: { full_name: string | null } | null;
    }>();
  if (organisationError || !organisation) {
    if (organisationError) await reportError(organisationError, { operation: "outreach.stage_two.load_client", organisationId });
    return NextResponse.json({ error: "That client could not be loaded." }, { status: organisation ? 500 : 404 });
  }
  let replyEvent: {
    id: string;
    outreach_message_id: string | null;
    reply_body: string;
  } | null = null;
  if (parsed.data.replyEventId) {
    const { data, error } = await supabase
      .from("reply_events")
      .select("id, outreach_message_id, reply_body")
      .eq("id", parsed.data.replyEventId)
      .eq("organisation_id", organisationId)
      .maybeSingle<{ id: string; outreach_message_id: string | null; reply_body: string }>();
    if (error) {
      await reportError(error, {
        operation: "outreach.stage_two.load_reply",
        organisationId,
        replyEventId: parsed.data.replyEventId,
      });
      return NextResponse.json({ error: "The client reply could not be loaded. Try again." }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ error: "That client reply is no longer available." }, { status: 404 });
    }
    replyEvent = data;
  }

  if (!replyEvent && !isStageTwoEligible(organisation.outreach_status)) {
    return NextResponse.json(
      { error: "A follow-up can only be generated after the Stage 1 email was sent and before a response or follow-up is recorded." },
      { status: 409 },
    );
  }

  // Server-side re-check of ownership and suppression immediately before paying
  // for generation — identical to Stage 1's gate and for the same reason: a
  // suppression or ownership change can land after the page loaded, and calling
  // this endpoint directly must not spend a paid Gemini call on a blocked
  // organisation. The outreach_messages RLS can_contact_organisation WITH CHECK
  // remains the final backstop at insert.
  const conflict = checkOwnershipConflict({
    ownerId: organisation.owner_id,
    ownerName: organisation.owner?.full_name,
    actorId: authorization.actor.id,
    actorRole: authorization.actor.role,
  });
  if (conflict.hasConflict) {
    logSecurityEvent("outreach.ownership_conflict_blocked", {
      operation: "outreach.stage_two",
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
      operation: "outreach.stage_two.suppression_lookup",
      organisationId,
    });
    return NextResponse.json(
      { error: "Suppression status could not be checked. Nothing was generated. Please try again." },
      { status: 503 },
    );
  }
  if (!suppressionResult.allowed) {
    logSecurityEvent("outreach.suppression_blocked", {
      operation: "outreach.stage_two",
      organisationId,
      suppressionId: suppressionResult.suppressionId,
      userId: authorization.actor.id,
    });
    return NextResponse.json(
      { error: suppressionBlockedMessage(suppressionResult.reason), reason: suppressionResult.reason },
      { status: 409 },
    );
  }

  // F135: when drafting from a reply, use the exact sent message that reply is
  // linked to. The browser supplies only the event id; both reply text and the
  // original email are loaded under RLS and scoped to this client here.
  let previousMessageQuery = supabase
    .from("outreach_messages")
    .select("subject, body")
    .eq("organisation_id", organisationId)
    .eq("send_status", "sent");
  if (replyEvent?.outreach_message_id) {
    previousMessageQuery = previousMessageQuery.eq("id", replyEvent.outreach_message_id);
  } else {
    previousMessageQuery = previousMessageQuery.order("sent_at", { ascending: false }).limit(1);
  }

  const [
    { data: contact, error: contactError },
    { data: enrichment, error: enrichmentError },
    { data: financialPeriod, error: financialError },
    { data: previousMessage, error: previousMessageError },
  ] = await Promise.all([
    supabase.from("contacts").select("id, first_name, last_name, job_title").eq("organisation_id", organisationId).order("is_primary", { ascending: false }).order("created_at", { ascending: true }).limit(1).maybeSingle(),
    supabase.from("enrichment_results").select("mission_statement, mission_keywords, sector, sub_sector, news_hooks").eq("organisation_id", organisationId).order("enriched_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("financial_periods").select("income_band").eq("organisation_id", organisationId).order("period_end", { ascending: false }).limit(1).maybeSingle(),
    previousMessageQuery.maybeSingle(),
  ]);
  if (contactError) await reportError(contactError, { operation: "outreach.stage_two.load_contact", organisationId });
  if (enrichmentError) await reportError(enrichmentError, { operation: "outreach.stage_two.load_context", organisationId });
  if (financialError) await reportError(financialError, { operation: "outreach.stage_two.load_financial_context", organisationId });
  if (previousMessageError) await reportError(previousMessageError, { operation: "outreach.stage_two.load_previous_email", organisationId });
  if (previousMessageError || !previousMessage) {
    return NextResponse.json(
      { error: "The previously sent email could not be loaded, so a safe follow-up cannot be generated." },
      { status: previousMessageError ? 500 : 409 },
    );
  }

  // F103 AC1 parity with Stage 1: the client's saved booklet (latest version per
  // F085/F086) is passed to generation as additional context. A missing booklet
  // is not an error — a follow-up still has the previous email to build on — so
  // this is tolerant of a failed read the same way the enrichment lookup is.
  const { data: savedBooklet, error: bookletError } = await supabase
    .from("client_booklets")
    .select("booklet_text")
    .eq("organisation_id", organisationId)
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ booklet_text: string }>();
  if (bookletError) {
    await reportError(bookletError, { operation: "outreach.stage_two.load_booklet", organisationId });
  }

  let callModel;
  let model: string;
  try {
    ({ callModel, model } = createStageTwoModelCall());
  } catch (error) {
    await reportError(error, { operation: "outreach.stage_two.configure", organisationId });
    return NextResponse.json({ error: "Email generation is not configured. Contact an administrator." }, { status: 503 });
  }

  const allowance = await consumeAiGenerationAllowance(admin, authorization.actor.id);
  if (!allowance.allowed) {
    if ("unavailable" in allowance) {
      return NextResponse.json({ error: allowance.message }, { status: 503 });
    }
    return NextResponse.json(
      { error: allowance.message, retryAt: allowance.retryAt.toISOString() },
      { status: 429, headers: { "Retry-After": String(allowance.retryAfterSeconds) } },
    );
  }

  const result = await generateStageTwoDraft(
    organisationId,
    {
      organisationName: organisation.legal_name,
      tradingName: organisation.trading_name,
      organisationType: organisation.organisation_type,
      website: organisation.website,
      city: organisation.city,
      countryCode: organisation.country_code,
      geographicReach: organisation.geographic_reach,
      incomeBand: financialPeriod?.income_band,
      contactName: contact ? [contact.first_name, contact.last_name].filter(Boolean).join(" ") : null,
      contactJobTitle: contact?.job_title,
      missionStatement: enrichment?.mission_statement,
      missionKeywords: enrichment?.mission_keywords,
      sector: enrichment?.sector,
      subSector: enrichment?.sub_sector,
      newsHooks: enrichment?.news_hooks,
      booklet: savedBooklet?.booklet_text ?? null,
      previousSubject: previousMessage.subject,
      // F117: the sent message's body may be HTML (new) or plain text (sent
      // before this feature) — either way the model prompt wants readable
      // plain text, not markup.
      previousBody: emailHtmlToPlainText(previousMessage.body),
      replyBody: replyEvent?.reply_body ?? null,
    },
    callModel,
    {
      length: parsed.data.length,
      voice: parsed.data.voice,
      tone: parsed.data.tone,
      closing: parsed.data.closing,
      newsEnabled: Boolean(enrichment?.news_hooks?.length),
    },
  );
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 502 });

  // A generated follow-up is persisted only as a draft. This route contains no send
  // operation and cannot set sent_at/send_status, preserving the human checkpoint.
  const { data: message, error: draftError } = await supabase
    .from("outreach_messages")
    .insert({
      organisation_id: organisationId,
      contact_id: contact?.id ?? null,
      sent_by_user_id: authorization.actor.id,
      subject: result.draft.subject,
      body: result.draft.body,
      send_status: "draft",
    })
    .select("id")
    .single();
  if (draftError || !message) {
    await reportError(draftError ?? new Error("Draft insert returned no row."), { operation: "outreach.stage_two.save_draft", organisationId });
    return NextResponse.json({ error: "The follow-up was generated but could not be saved. Try again." }, { status: 500 });
  }

  // F213 — LLM Cost Tracking AC3, mirroring Stage 1: a pricing lookup failure must
  // never block saving a generation that already succeeded, so this is best-effort
  // — a missing or errored rate prices as unknown (null), never a fabricated 0.
  const { data: pricing, error: pricingError } = await supabase
    .from("model_pricing")
    .select("input_usd_per_1k_tokens, output_usd_per_1k_tokens")
    .eq("model", model)
    .maybeSingle();
  if (pricingError) {
    await reportError(pricingError, {
      operation: "outreach.stage_two.load_pricing",
      organisationId,
      model,
    });
  }
  const costUsd = computeCostUsd(
    { inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens },
    pricing
      ? {
          inputUsdPer1kTokens: pricing.input_usd_per_1k_tokens,
          outputUsdPer1kTokens: pricing.output_usd_per_1k_tokens,
        }
      : null,
  );

  const { error: generationError } = await admin
    .from("ai_generations")
    .insert(
      buildStageTwoGenerationInsert({
        outreachMessageId: message.id,
        draft: result.draft,
        model,
        usage: result.usage,
        costUsd,
        prompt: result.prompt,
      }),
    );
  if (generationError) {
    // Compensating delete: roll back the orphan draft. If the rollback itself
    // fails, report it rather than silently leaving an outreach_messages row
    // with no ai_generations record behind.
    const { error: rollbackError } = await supabase
      .from("outreach_messages")
      .delete()
      .eq("id", message.id);
    if (rollbackError) {
      await reportError(rollbackError, { operation: "outreach.stage_two.rollback_draft", organisationId, outreachMessageId: message.id });
    }
    await reportError(generationError, { operation: "outreach.stage_two.save_generation", organisationId, outreachMessageId: message.id });
    return NextResponse.json({ error: "The follow-up draft could not be saved safely. Try again." }, { status: 500 });
  }

  return NextResponse.json({ id: message.id, ...result.draft }, { status: 201 });
}
