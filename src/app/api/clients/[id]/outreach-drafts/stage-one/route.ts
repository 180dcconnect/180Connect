import { NextResponse } from "next/server";
import { z } from "zod";
import { actorFailureMessage, getCurrentActor } from "@/lib/auth/actor";
import { reportError } from "@/lib/error-logging";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  createStageOneModelCall,
  generateStageOneDraft,
} from "@/lib/outreach/stage-one-generation";
import { computeCostUsd } from "@/lib/outreach/generation-cost";

export const maxDuration = 60;

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
    .select("id, legal_name, organisation_type, website, city, country_code")
    .eq("id", organisationId)
    .maybeSingle();
  if (organisationError || !organisation) {
    if (organisationError) await reportError(organisationError, { operation: "outreach.stage_one.load_client", organisationId });
    return NextResponse.json({ error: "That client could not be loaded." }, { status: organisation ? 500 : 404 });
  }

  const [{ data: contact, error: contactError }, { data: enrichment, error: enrichmentError }] = await Promise.all([
    supabase.from("contacts").select("id, first_name, last_name, job_title").eq("organisation_id", organisationId).order("is_primary", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("enrichment_results").select("mission_statement, mission_keywords, sector, sub_sector, news_hooks").eq("organisation_id", organisationId).order("enriched_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (contactError) await reportError(contactError, { operation: "outreach.stage_one.load_contact", organisationId });
  if (enrichmentError) await reportError(enrichmentError, { operation: "outreach.stage_one.load_context", organisationId });

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
      organisationType: organisation.organisation_type,
      website: organisation.website,
      city: organisation.city,
      countryCode: organisation.country_code,
      contactName: contact ? [contact.first_name, contact.last_name].filter(Boolean).join(" ") : null,
      contactJobTitle: contact?.job_title,
      missionStatement: enrichment?.mission_statement,
      missionKeywords: enrichment?.mission_keywords,
      sector: enrichment?.sector,
      subSector: enrichment?.sub_sector,
      newsHooks: enrichment?.news_hooks,
    },
    callModel,
  );
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 502 });

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
    await reportError(draftError ?? new Error("Draft insert returned no row."), { operation: "outreach.stage_one.save_draft", organisationId });
    return NextResponse.json({ error: "The draft was generated but could not be saved. Try again." }, { status: 500 });
  }

  // F213 — LLM Cost Tracking (#208) AC3: a pricing lookup failure must never block
  // generation, which has already fully succeeded by this point — so this is a
  // best-effort read, never a thrown error the request could fail on. A missing
  // or errored rate prices as unknown (null), never a fabricated 0 — see
  // generation-cost.ts and the model_pricing migration for why.
  const { data: pricing } = await supabase
    .from("model_pricing")
    .select("input_usd_per_1k_tokens, output_usd_per_1k_tokens")
    .eq("model", model)
    .maybeSingle();
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
    input_tokens: result.usage.inputTokens ?? null,
    output_tokens: result.usage.outputTokens ?? null,
    total_tokens: result.usage.totalTokens ?? null,
    cost_usd: costUsd,
  });
  if (generationError) {
    await supabase.from("outreach_messages").delete().eq("id", message.id);
    await reportError(generationError, { operation: "outreach.stage_one.save_generation", organisationId, outreachMessageId: message.id });
    return NextResponse.json({ error: "The draft could not be saved safely. Try again." }, { status: 500 });
  }

  return NextResponse.json({ id: message.id, ...result.draft }, { status: 201 });
}
