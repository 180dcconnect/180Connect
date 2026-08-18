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
import { CLOSING_APPROACHES, EMAIL_LENGTHS, EMAIL_TONES, EMAIL_VOICES, OPENING_APPROACHES } from "@/lib/outreach/stage-one-prompt";

export const maxDuration = 60;

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

  const requestBody = await request.json().catch(() => ({}));
  const preferences = z.object({
    length: z.enum(EMAIL_LENGTHS).default("standard"),
    voice: z.enum(EMAIL_VOICES).default("180dc"),
    tone: z.enum(EMAIL_TONES).default("balanced"),
    opening: z.enum(OPENING_APPROACHES).default("mission_led"),
    closing: z.enum(CLOSING_APPROACHES).default("soft_cta"),
  }).safeParse(requestBody);
  if (!preferences.success) {
    return NextResponse.json({ error: "Choose a valid email length and try again." }, { status: 400 });
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
    .select("id, legal_name, trading_name, organisation_type, website, city, country_code, geographic_reach")
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
  try {
    callModel = createStageOneModelCall();
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
      contactName: contact ? [contact.first_name, contact.last_name].filter(Boolean).join(" ") : null,
      contactJobTitle: contact?.job_title,
      missionStatement: enrichment?.mission_statement,
      missionKeywords: enrichment?.mission_keywords,
      sector: enrichment?.sector,
      subSector: enrichment?.sub_sector,
      newsHooks: enrichment?.news_hooks,
    },
    callModel,
    { length: preferences.data.length, voice: preferences.data.voice, tone: preferences.data.tone, opening: preferences.data.opening, closing: preferences.data.closing },
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

  const { error: generationError } = await admin.from("ai_generations").insert({
    outreach_message_id: message.id,
    generated_subject: result.draft.subject,
    generated_body: result.draft.body,
  });
  if (generationError) {
    await supabase.from("outreach_messages").delete().eq("id", message.id);
    await reportError(generationError, { operation: "outreach.stage_one.save_generation", organisationId, outreachMessageId: message.id });
    return NextResponse.json({ error: "The draft could not be saved safely. Try again." }, { status: 500 });
  }

  return NextResponse.json({ id: message.id, ...result.draft }, { status: 201 });
}
