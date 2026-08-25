import { NextResponse } from "next/server";
import { z } from "zod";
import { actorFailureMessage, getCurrentActor } from "@/lib/auth/actor";
import { reportError } from "@/lib/error-logging";
import { logSecurityEvent } from "@/lib/log-security-event";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  createStageOneModelCall,
  generateStageOneDraft,
} from "@/lib/outreach/stage-one-generation";
import { CLOSING_APPROACHES, EMAIL_LENGTHS, EMAIL_TONES, EMAIL_VOICES, OPENING_APPROACHES } from "@/lib/outreach/stage-one-prompt";
import {
  checkSuppressionBeforeSend,
  suppressionBlockedMessage,
  type ActiveSuppression,
} from "@/lib/outreach/suppression-check";
import { checkOwnershipConflict } from "@/lib/outreach/ownership-conflict";
import { computeCostUsd } from "@/lib/outreach/generation-cost";

export const maxDuration = 60;

// F111 — Regenerate Email Draft: a request with no draftId (or an omitted body) is
// the first generation for this review session; a request that names an existing
// draft is a regeneration and updates that same row in place rather than stacking a
// second draft next to it (AC2). Either way generation itself is identical — only
// how the result is persisted differs.
const bodySchema = z.object({ draftId: z.uuid().optional() });

export async function POST(
  request: Request,
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

  // No body at all is the common case (first generation) — treat it the same as `{}`
  // rather than rejecting it, since only a regeneration ever needs to send a draftId.
  const rawBody = await request.text();
  let parsedInput: unknown = {};
  try {
    parsedInput = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    return NextResponse.json({ error: "That draft could not be identified." }, { status: 400 });
  }
  const parsedBody = bodySchema.safeParse(parsedInput);
  if (!parsedBody.success) {
    return NextResponse.json({ error: "That draft could not be identified." }, { status: 400 });
  }
  const { draftId } = parsedBody.data;

  // The booklet is deliberately NOT part of the request body: F103 reads the saved
  // booklet (F085/F086) straight from client_booklets so the text reaching the
  // prompt is exactly what RLS-protected storage holds, never a client-supplied string.
  const preferences = z
    .object({
      length: z.enum(EMAIL_LENGTHS).default("standard"),
      voice: z.enum(EMAIL_VOICES).default("180dc"),
      tone: z.enum(EMAIL_TONES).default("balanced"),
      opening: z.enum(OPENING_APPROACHES).default("mission_led"),
      closing: z.enum(CLOSING_APPROACHES).default("soft_cta"),
    })
    .safeParse(parsedInput);
  if (!preferences.success) {
    return NextResponse.json({ error: "Choose a valid email length, voice, tone, opening and closing approach, then try again." }, { status: 400 });
  }

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json(
      { error: "Email generation is not configured. Contact an administrator." },
      { status: 503 },
    );
  }

  const supabase = await createClient();
  const { data: organisation, error: organisationError } = await supabase
    .from("organisations")
    .select(
      "id, legal_name, trading_name, organisation_type, website, city, country_code, geographic_reach, owner_id, contact_email, owner:users!organisations_owner_id_fkey(full_name)",
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
      owner_id: string | null;
      contact_email: string | null;
      owner: { full_name: string | null } | null;
    }>();
  if (organisationError || !organisation) {
    if (organisationError) await reportError(organisationError, { operation: "outreach.stage_one.load_client", organisationId });
    return NextResponse.json({ error: "That client could not be loaded." }, { status: organisation ? 500 : 404 });
  }

  // Server-side re-check of ownership and suppression immediately before paying
  // for generation. The client runs /outreach-preflight first, but only this
  // route is trusted: a suppression or ownership change can land between
  // preflight and this call, and calling this endpoint directly must not spend
  // a paid Gemini call on a blocked organisation. The outreach_messages RLS
  // can_contact_organisation WITH CHECK remains the final backstop at insert.
  const conflict = checkOwnershipConflict({
    ownerId: organisation.owner_id,
    ownerName: organisation.owner?.full_name,
    actorId: authorization.actor.id,
    actorRole: authorization.actor.role,
  });
  if (conflict.hasConflict) {
    logSecurityEvent("outreach.ownership_conflict_blocked", {
      operation: "outreach.stage_one",
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
      operation: "outreach.stage_one.suppression_lookup",
      organisationId,
    });
    return NextResponse.json(
      { error: "Suppression status could not be checked. Nothing was generated. Please try again." },
      { status: 503 },
    );
  }
  if (!suppressionResult.allowed) {
    logSecurityEvent("outreach.suppression_blocked", {
      operation: "outreach.stage_one",
      organisationId,
      suppressionId: suppressionResult.suppressionId,
      userId: authorization.actor.id,
    });
    return NextResponse.json(
      { error: suppressionBlockedMessage(suppressionResult.reason), reason: suppressionResult.reason },
      { status: 409 },
    );
  }

  const [
    { data: contact, error: contactError },
    { data: enrichment, error: enrichmentError },
    { data: financialPeriod, error: financialError },
  ] = await Promise.all([
    supabase.from("contacts").select("id, first_name, last_name, job_title, email").eq("organisation_id", organisationId).order("is_primary", { ascending: false }).order("created_at", { ascending: true }).limit(1).maybeSingle(),
    supabase.from("enrichment_results").select("mission_statement, mission_keywords, sector, sub_sector, news_hooks").eq("organisation_id", organisationId).order("enriched_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("financial_periods").select("income_band").eq("organisation_id", organisationId).order("period_end", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (contactError) await reportError(contactError, { operation: "outreach.stage_one.load_contact", organisationId });
  if (enrichmentError) await reportError(enrichmentError, { operation: "outreach.stage_one.load_context", organisationId });
  if (financialError) await reportError(financialError, { operation: "outreach.stage_one.load_financial_context", organisationId });

  // F103 AC1: the client's saved booklet (latest version per F085/F086) is passed
  // to generation as additional context. A missing booklet is not an error —
  // generation continues on profile data alone (F102), so this is tolerant of a
  // failed read the same way the enrichment lookup above is.
  const { data: savedBooklet, error: bookletError } = await supabase
    .from("client_booklets")
    .select("booklet_text")
    .eq("organisation_id", organisationId)
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ booklet_text: string }>();
  if (bookletError) {
    await reportError(bookletError, { operation: "outreach.stage_one.load_booklet", organisationId });
  }

  let callModel;
  let model: string;
  try {
    ({ callModel, model } = createStageOneModelCall());
  } catch (error) {
    await reportError(error, { operation: "outreach.stage_one.configure", organisationId });
    return NextResponse.json(
      { error: "Email generation is not configured. Contact an administrator." },
      { status: 503 },
    );
  }

  const result = await generateStageOneDraft(
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
    },
    callModel,
    { length: preferences.data.length, voice: preferences.data.voice, tone: preferences.data.tone, opening: preferences.data.opening, closing: preferences.data.closing },
  );
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 502 });

  // F111 — Regenerate Email Draft (#108) AC2: a regeneration updates the same
  // outreach_messages row rather than inserting a new one, so only ever one draft is
  // on screen (or in the table) per review session. RLS's own drafts-only update
  // policies (organisation_id + send_status = 'draft') double as the check that the
  // named draft is still this org's and still editable — a stale or already-sent id
  // matches zero rows rather than silently updating the wrong thing.
  const isRegeneration = draftId !== undefined;
  const { data: message, error: draftError } = isRegeneration
    ? await supabase
        .from("outreach_messages")
        .update({ subject: result.draft.subject, body: result.draft.body })
        .eq("id", draftId)
        .eq("organisation_id", organisationId)
        .select("id")
        .maybeSingle()
    : await supabase
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
  if (isRegeneration && !draftError && !message) {
    return NextResponse.json(
      { error: "This draft could not be found — it may have already been sent or removed. Refresh and try again." },
      { status: 409 },
    );
  }
  if (draftError || !message) {
    await reportError(draftError ?? new Error("Draft insert returned no row."), { operation: "outreach.stage_one.save_draft", organisationId });
    return NextResponse.json({ error: "The draft was generated but could not be saved. Try again." }, { status: 500 });
  }

  // F213 — LLM Cost Tracking (#208) AC3: a pricing lookup failure must never block
  // generation, which has already fully succeeded by this point — so this is a
  // best-effort read, never a thrown error the request could fail on. A missing
  // or errored rate prices as unknown (null), never a fabricated 0 — see
  // generation-cost.ts and the model_pricing migration for why. "Best-effort"
  // still means visible: an errored (as opposed to merely empty) lookup is
  // reported like every other non-fatal read in this route — the DoD requires
  // failures to reach ERROR_LOG even when the request itself succeeds.
  const { data: pricing, error: pricingError } = await supabase
    .from("model_pricing")
    .select("input_usd_per_1k_tokens, output_usd_per_1k_tokens")
    .eq("model", model)
    .maybeSingle();
  if (pricingError) {
    await reportError(pricingError, {
      operation: "outreach.stage_one.load_pricing",
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

  const { error: generationError } = await admin.from("ai_generations").insert({
    outreach_message_id: message.id,
    generated_subject: result.draft.subject,
    generated_body: result.draft.body,
    // F113: the model in force at generation time, not a live lookup of the current
    // default — see the migration for why a later env change must never rewrite history.
    model,
    // F112: the exact prompt this generation actually sent — every attempt (create
    // or regenerate) gets its own row here, never overwritten, so this is also the
    // audit trail AC3 asks for.
    prompt_system: result.prompt.system,
    prompt_user: result.prompt.user,
    input_tokens: result.usage.inputTokens ?? null,
    output_tokens: result.usage.outputTokens ?? null,
    total_tokens: result.usage.totalTokens ?? null,
    cost_usd: costUsd,
  });
  if (generationError) {
    // Compensating delete: roll back the orphan draft — but only a fresh one. A
    // regeneration's outreach_messages row pre-dates this request and holds the
    // CAM's own prior content; deleting it on an audit-log write failure would
    // destroy real work over a secondary write issue. If the rollback itself
    // fails, report it rather than silently leaving an outreach_messages row
    // with no ai_generations record behind.
    if (!isRegeneration) {
      const { error: rollbackError } = await supabase
        .from("outreach_messages")
        .delete()
        .eq("id", message.id);
      if (rollbackError) {
        await reportError(rollbackError, { operation: "outreach.stage_one.rollback_draft", organisationId, outreachMessageId: message.id });
      }
    }
    await reportError(generationError, { operation: "outreach.stage_one.save_generation", organisationId, outreachMessageId: message.id });
    return NextResponse.json({ error: "The draft could not be saved safely. Try again." }, { status: 500 });
  }

  return NextResponse.json(
    {
      id: message.id,
      ...result.draft,
      sizeTemplate: result.sizeTemplate,
      // F116: the recipient the CAM's review starts from — whichever email
      // sendReviewedEmail would otherwise fall back to. Editable from here on;
      // the editor compares later edits against this to warn on drift.
      recipientOnFile: contact?.email?.trim() || organisation.contact_email?.trim() || null,
    },
    { status: isRegeneration ? 200 : 201 },
  );
}
