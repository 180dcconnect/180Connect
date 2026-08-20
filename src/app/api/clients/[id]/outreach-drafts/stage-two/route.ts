import { NextResponse } from "next/server";
import { z } from "zod";
import { actorFailureMessage, getCurrentActor } from "@/lib/auth/actor";
import { reportError } from "@/lib/error-logging";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  createStageTwoModelCall,
  generateStageTwoDraft,
  isStageTwoEligible,
} from "@/lib/outreach/stage-two-generation";
import { CLOSING_APPROACHES, EMAIL_LENGTHS, EMAIL_TONES, EMAIL_VOICES } from "@/lib/outreach/stage-one-prompt";

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

  const parsed = z.object({
    length: z.enum(EMAIL_LENGTHS).default("standard"),
    voice: z.enum(EMAIL_VOICES).default("180dc"),
    tone: z.enum(EMAIL_TONES).default("balanced"),
    closing: z.enum(CLOSING_APPROACHES).default("soft_cta"),
    booklet: z.string().trim().min(1).max(20_000).nullable().optional(),
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
    .select("id, legal_name, trading_name, organisation_type, website, city, country_code, geographic_reach, outreach_status")
    .eq("id", organisationId)
    .maybeSingle();
  if (organisationError || !organisation) {
    if (organisationError) await reportError(organisationError, { operation: "outreach.stage_two.load_client", organisationId });
    return NextResponse.json({ error: "That client could not be loaded." }, { status: organisation ? 500 : 404 });
  }
  if (!isStageTwoEligible(organisation.outreach_status)) {
    return NextResponse.json(
      { error: "A follow-up can only be generated after the Stage 1 email was sent and before a response or follow-up is recorded." },
      { status: 409 },
    );
  }

  const [
    { data: contact, error: contactError },
    { data: enrichment, error: enrichmentError },
    { data: financialPeriod, error: financialError },
    { data: previousMessage, error: previousMessageError },
  ] = await Promise.all([
    supabase.from("contacts").select("id, first_name, last_name, job_title").eq("organisation_id", organisationId).order("is_primary", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("enrichment_results").select("mission_statement, mission_keywords, sector, sub_sector, news_hooks").eq("organisation_id", organisationId).order("enriched_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("financial_periods").select("income_band").eq("organisation_id", organisationId).order("period_end", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("outreach_messages").select("subject, body").eq("organisation_id", organisationId).eq("send_status", "sent").order("sent_at", { ascending: false }).limit(1).maybeSingle(),
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

  let callModel;
  try {
    callModel = createStageTwoModelCall();
  } catch (error) {
    await reportError(error, { operation: "outreach.stage_two.configure", organisationId });
    return NextResponse.json({ error: "Email generation is not configured. Contact an administrator." }, { status: 503 });
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
      booklet: parsed.data.booklet,
      previousSubject: previousMessage.subject,
      previousBody: previousMessage.body,
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

  const { error: generationError } = await admin.from("ai_generations").insert({
    outreach_message_id: message.id,
    generated_subject: result.draft.subject,
    generated_body: result.draft.body,
  });
  if (generationError) {
    await supabase.from("outreach_messages").delete().eq("id", message.id);
    await reportError(generationError, { operation: "outreach.stage_two.save_generation", organisationId, outreachMessageId: message.id });
    return NextResponse.json({ error: "The follow-up draft could not be saved safely. Try again." }, { status: 500 });
  }

  return NextResponse.json({ id: message.id, ...result.draft }, { status: 201 });
}
