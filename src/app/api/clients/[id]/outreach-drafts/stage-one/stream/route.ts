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
import { loadStageOneExtras, toStageOneContext } from "@/lib/outreach/stage-one-context";
import { resolveStageOneNews } from "@/lib/outreach/stage-one-news";

// No maxDuration export — see the stage-one route: the 300s project default
// applies, and a distinct value would cost a Vercel function.

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
 * The *guards* intentionally mirror the POST route field-for-field rather than
 * sharing it: the two must never disagree about what may generate, and a shared
 * helper edited for streaming could silently change what the send path checks.
 *
 * The *context* is the opposite case and is shared (`loadStageOneExtras` +
 * `toStageOneContext`). Duplicating it here did exactly what duplication does:
 * this route drifted and stopped passing F220's extracted PDF text, so every
 * draft written through the compose window — which streams — silently lost a
 * client's uploaded documents while the POST route beside it kept them. What
 * the model is told about a client is not a permission check, and the two
 * paths have no business disagreeing about it.
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
      "id, legal_name, trading_name, organisation_type, website, city, country_code, geographic_reach, sector, sub_sector, owner_id, contact_email, charity_activities, cic_community_statement, owner:users!organisations_owner_id_fkey(full_name)",
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
      charity_activities: string | null;
      cic_community_statement: string | null;
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

  const extras = await loadStageOneExtras(supabase, organisationId, "outreach.stage_one");

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

  // F110 for first contact: a live lookup, but only when the CAM chose the
  // news-hook opening — see stage-one-news.ts. Run before the stream opens so a
  // slow provider costs a skeleton rather than a stalled token stream.
  const news = await resolveStageOneNews({
    opening: preferences.data.opening,
    organisationId,
    organisationName: organisation.legal_name,
    tradingName: organisation.trading_name,
    website: organisation.website,
    city: organisation.city,
    countryCode: organisation.country_code,
    geographicReach: organisation.geographic_reach,
    sector: organisation.sector,
    storedHooks: extras.enrichment?.news_hooks,
  });

  const actorId = authorization.actor.id;
  const context = {
    ...toStageOneContext({
      organisation,
      extras,
      senderName: authorization.actor.fullName,
      attachFlyer: preferences.data.attachFlyer,
    }),
    newsHooks: news.hooks,
  };
  const contactRow = extras.contact;
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
          context,
          streamModel,
          (event) => send(event),
          { length: preferences.data.length, register: preferences.data.register, opening: preferences.data.opening, closing: preferences.data.closing },
          callModel,
        );
        if ("error" in result) return fail(result.error);

        const { data: message, error: draftError } = isRegeneration
          ? await supabase
              .from("outreach_messages")
              .update({
                subject: result.draft.subject,
                body: result.draft.body,
                attach_flyer: preferences.data.attachFlyer,
                // Rewritten on every regeneration, including back to null, so a
                // regeneration that found no hook cannot keep the last one's
                // article link on the row as if it were this draft's.
                news_source: news.live ? "live" : null,
                news_hook: news.live?.text ?? null,
                news_url: news.live?.url ?? null,
              })
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
                attach_flyer: preferences.data.attachFlyer,
                send_status: "draft",
                news_source: news.live ? "live" : null,
                news_hook: news.live?.text ?? null,
                news_url: news.live?.url ?? null,
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
