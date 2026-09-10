import { NextResponse } from "next/server";
import { z } from "zod";
import { actorFailureMessage, getCurrentActor } from "@/lib/auth/actor";
import { reportError } from "@/lib/error-logging";
import { logSecurityEvent } from "@/lib/log-security-event";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { createStageOneStreamCall, streamStageOneDraft } from "@/lib/outreach/stage-one-stream";
import { CLOSING_APPROACHES, EMAIL_LENGTHS, EMAIL_REGISTERS, OPENING_APPROACHES } from "@/lib/outreach/stage-one-prompt";
import {
  checkSuppressionBeforeSend,
  suppressionBlockedMessage,
  type ActiveSuppression,
} from "@/lib/outreach/suppression-check";
import { checkOwnershipConflict } from "@/lib/outreach/ownership-conflict";
import { computeCostUsd } from "@/lib/outreach/generation-cost";
import { loadModelRate } from "@/lib/ai/model-rate";
import { consumeAiGenerationAllowance } from "@/lib/ai/rate-limit";

export const maxDuration = 60;

/**
 * Token-streaming twin of the stage-one POST route beside it.
 *
 * The non-streaming route waits 30–50s and hands back one JSON object — a
 * silence the browser can only render as a skeleton. This endpoint runs the
 * same checks on the same tables, then holds a `text/event-stream` response
 * open while the model writes: `stage` milestones, `subject` once complete,
 * `delta` tails of the body as they arrive, and a final `done` once the draft
 * row and its audit row are persisted. Anything that fails before the first
 * token returns a normal JSON error with the same status the POST route would
 * have used; anything that fails mid-stream arrives as an `error` event.
 *
 * The preamble intentionally mirrors the POST route field-for-field (same
 * guards, same fail-soft reads) rather than sharing it: the two must never
 * disagree about what may generate, and a shared helper edited for streaming
 * could silently change what the send path checks.
 */
const bodySchema = z.object({ draftId: z.uuid().optional() });

type StreamDone = {
  type: "done";
  id: string;
  subject: string;
  body: string;
  sizeTemplate: string;
  recipientOnFile: string | null;
};

type StreamError = { type: "error"; error: string; status?: number };

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

  const preferences = z
    .object({
      length: z.enum(EMAIL_LENGTHS).default("standard"),
      register: z.enum(EMAIL_REGISTERS).default("professional"),
    attachFlyer: z.boolean().default(false),
      opening: z.enum(OPENING_APPROACHES).default("mission_led"),
      closing: z.enum(CLOSING_APPROACHES).default("soft_cta"),
    })
    .safeParse(parsedInput);
  if (!preferences.success) {
    return NextResponse.json({ error: "Choose a valid email length, register, opening and closing approach, then try again." }, { status: 400 });
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
      "id, legal_name, trading_name, organisation_type, website, city, country_code, geographic_reach, sector, sub_sector, owner_id, contact_email, owner:users!organisations_owner_id_fkey(full_name)",
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
      sector: string | null;
      sub_sector: string | null;
      owner_id: string | null;
      contact_email: string | null;
      owner: { full_name: string | null } | null;
    }>();
  if (organisationError || !organisation) {
    if (organisationError) await reportError(organisationError, { operation: "outreach.stage_one.load_client", organisationId });
    return NextResponse.json({ error: "That client could not be loaded." }, { status: organisation ? 500 : 404 });
  }

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

  let streamModel;
  let callModel;
  let model: string;
  try {
    ({ streamModel, callModel, model } = createStageOneStreamCall());
  } catch (error) {
    await reportError(error, { operation: "outreach.stage_one.configure", organisationId });
    return NextResponse.json(
      { error: "Email generation is not configured. Contact an administrator." },
      { status: 503 },
    );
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

  const actorId = authorization.actor.id;
  const senderName = authorization.actor.fullName;
  const contactRow = contact as { id: string; first_name: string | null; last_name: string | null; job_title: string | null; email: string | null } | null;
  const enrichmentRow = enrichment as { mission_statement: string | null; mission_keywords: string[] | null; sector: string | null; sub_sector: string | null; news_hooks: string[] | null } | null;
  const financialRow = financialPeriod as { income_band: "under_10k" | "10k_100k" | "100k_1m" | "over_1m" | null } | null;
  const isRegeneration = draftId !== undefined;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: Record<string, unknown>) => {
        controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`));
      };
      const fail = (error: string, status?: number) => {
        send({ type: "error", error, status } satisfies StreamError);
        controller.close();
      };
      try {
        const result = await streamStageOneDraft(
          organisationId,
          {
            organisationName: organisation.legal_name,
            tradingName: organisation.trading_name,
            organisationType: organisation.organisation_type,
            website: organisation.website,
            city: organisation.city,
            countryCode: organisation.country_code,
            geographicReach: organisation.geographic_reach,
            incomeBand: financialRow?.income_band,
            contactName: contactRow ? [contactRow.first_name, contactRow.last_name].filter(Boolean).join(" ") : null,
            contactJobTitle: contactRow?.job_title,
            missionStatement: enrichmentRow?.mission_statement,
            missionKeywords: enrichmentRow?.mission_keywords,
            sector: organisation.sector?.trim() || enrichmentRow?.sector,
            subSector: organisation.sub_sector?.trim() || enrichmentRow?.sub_sector,
            newsHooks: enrichmentRow?.news_hooks,
            booklet: savedBooklet?.booklet_text ?? null,
            senderName,
            attachFlyer: preferences.data.attachFlyer,
          },
          streamModel,
          (event) => send(event),
          { length: preferences.data.length, register: preferences.data.register, opening: preferences.data.opening, closing: preferences.data.closing },
          callModel,
        );
        if ("error" in result) return fail(result.error);

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
                contact_id: contactRow?.id ?? null,
                sent_by_user_id: actorId,
                subject: result.draft.subject,
                body: result.draft.body,
                send_status: "draft",
              })
              .select("id")
              .single();
        if (isRegeneration && !draftError && !message) {
          return fail("This draft could not be found — it may have already been sent or removed. Refresh and try again.", 409);
        }
        if (draftError || !message) {
          await reportError(draftError ?? new Error("Draft insert returned no row."), { operation: "outreach.stage_one.save_draft", organisationId });
          return fail("The draft was generated but could not be saved. Try again.");
        }

        const pricing = await loadModelRate(
    () =>
      supabase
        .from("model_pricing")
        .select("input_usd_per_1k_tokens, output_usd_per_1k_tokens")
        .eq("model", model)
        .maybeSingle(),
    model,
    "outreach.stage_one.load_pricing",
  );
        const costUsd = computeCostUsd(
          { inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens },
          pricing,
        );

        const { error: generationError } = await admin.from("ai_generations").insert({
          outreach_message_id: message.id,
          generated_subject: result.draft.subject,
          generated_body: result.draft.body,
          model,
          // F209: the F107 tone dials this request chose, written once at generation
          // time so the analytics group by what actually ran, not by today's defaults.
          tone_register: preferences.data.register,
          tone_length: preferences.data.length,
          activity: isRegeneration ? "email_regeneration" : "initial_email",
          prompt_system: result.prompt.system,
          prompt_user: result.prompt.user,
          input_tokens: result.usage.inputTokens ?? null,
          output_tokens: result.usage.outputTokens ?? null,
          total_tokens: result.usage.totalTokens ?? null,
          cost_usd: costUsd,
        });
        if (generationError) {
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
          return fail("The draft could not be saved safely. Try again.");
        }

        send({
          type: "done",
          id: message.id,
          subject: result.draft.subject,
          body: result.draft.body,
          sizeTemplate: result.sizeTemplate,
          recipientOnFile: contactRow?.email?.trim() || organisation.contact_email?.trim() || null,
        } satisfies StreamDone);
        controller.close();
      } catch (error) {
        await reportError(error, { operation: "outreach.stage_one.stream", organisationId });
        fail("The email draft could not be generated. Try again.");
      }
    },
    cancel() {},
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
