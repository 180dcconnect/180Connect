/**
 * The client context a Stage 1 outreach draft is generated from — assembled in
 * one place so the two callers cannot drift apart.
 *
 * The caller is the real generation route (`/api/clients/[id]/outreach-drafts/stage-one`,
 * which a CAM triggers from the client profile).
 *
 * Split in two on the usual line: `loadStageOneExtras` does the reads,
 * `toStageOneContext` is pure and maps rows to the prompt's input, so the
 * mapping — which is where the fallbacks live, and the part worth testing — is
 * testable without a database.
 */

import { buildAttachmentEmailContext } from "../attachments.ts";
import { reportError } from "../error-logging.ts";
import { resolveMissionText } from "../mission.ts";
import type { StageOneContext } from "./stage-one-prompt.ts";
import type { createClient } from "../supabase/server.ts";

/** Type-only, so this module never pulls `server-only`/`next/headers` into a test. */
type ServerSupabase = Awaited<ReturnType<typeof createClient>>;

/**
 * The organisations columns a Stage 1 prompt needs. Exported as one string so
 * a caller that adds a column to its own select cannot accidentally drop one
 * the prompt depends on.
 */
export const STAGE_ONE_ORGANISATION_COLUMNS =
  "id, legal_name, trading_name, organisation_type, website, city, country_code, geographic_reach, sector, sub_sector, charity_activities, cic_community_statement";

export type StageOneOrganisationRow = {
  legal_name: string;
  trading_name: string | null;
  organisation_type: string;
  website: string | null;
  city: string | null;
  country_code: string | null;
  geographic_reach: string | null;
  sector: string | null;
  sub_sector: string | null;
  charity_activities: string | null;
  cic_community_statement: string | null;
};

export type StageOneContactRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  job_title: string | null;
  email: string | null;
};

export type StageOneEnrichmentRow = {
  mission_statement: string | null;
  mission_keywords: string[] | null;
  sector: string | null;
  sub_sector: string | null;
  news_hooks: string[] | null;
};

export type StageOneExtras = {
  contact: StageOneContactRow | null;
  enrichment: StageOneEnrichmentRow | null;
  incomeBand: StageOneContext["incomeBand"];
  booklet: string | null;
  attachmentText: string | null;
};

/**
 * Every read the prompt's context needs beyond the organisation row itself.
 *
 * None of them is fatal. A client with no contact, no enrichment, no filed
 * accounts, no booklet and no attachments still generates a useful general
 * introduction (F102), so a failed read is reported and then treated exactly
 * like an absent row — the same tolerance the route has always had.
 */
export async function loadStageOneExtras(
  supabase: ServerSupabase,
  organisationId: string,
  operationPrefix: string,
): Promise<StageOneExtras> {
  const [
    { data: contact, error: contactError },
    { data: enrichment, error: enrichmentError },
    { data: financialPeriod, error: financialError },
  ] = await Promise.all([
    supabase
      .from("contacts")
      .select("id, first_name, last_name, job_title, email")
      .eq("organisation_id", organisationId)
      .order("is_primary", { ascending: false })
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("enrichment_results")
      .select("mission_statement, mission_keywords, sector, sub_sector, news_hooks")
      .eq("organisation_id", organisationId)
      .order("enriched_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("financial_periods")
      .select("income_band")
      .eq("organisation_id", organisationId)
      .order("period_end", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (contactError) await reportError(contactError, { operation: `${operationPrefix}.load_contact`, organisationId });
  if (enrichmentError) await reportError(enrichmentError, { operation: `${operationPrefix}.load_context`, organisationId });
  if (financialError) await reportError(financialError, { operation: `${operationPrefix}.load_financial_context`, organisationId });

  // F103 AC1: the client's saved booklet (latest version per F085/F086) is
  // passed to generation as additional context.
  const { data: savedBooklet, error: bookletError } = await supabase
    .from("client_booklets")
    .select("booklet_text")
    .eq("organisation_id", organisationId)
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ booklet_text: string }>();
  if (bookletError) {
    await reportError(bookletError, { operation: `${operationPrefix}.load_booklet`, organisationId });
  }

  const { data: extractedAttachments, error: attachmentContextError } = await supabase
    .from("attachments")
    .select("filename, extracted_text")
    .eq("organisation_id", organisationId)
    .eq("text_extraction_status", "succeeded")
    .order("created_at", { ascending: false });
  if (attachmentContextError) {
    await reportError(attachmentContextError, {
      operation: `${operationPrefix}.load_attachment_context`,
      organisationId,
    });
  }

  return {
    contact: (contact as StageOneContactRow | null) ?? null,
    enrichment: (enrichment as StageOneEnrichmentRow | null) ?? null,
    incomeBand: (financialPeriod?.income_band as StageOneContext["incomeBand"]) ?? null,
    booklet: savedBooklet?.booklet_text ?? null,
    attachmentText: buildAttachmentEmailContext(extractedAttachments ?? []),
  };
}

/**
 * Rows in, prompt context out. Pure.
 *
 * The two fallbacks here are the ones worth naming, because reading only the
 * enrichment side of either produced visibly worse drafts:
 *
 * - Mission resolves the canonical register purpose first (charity activities,
 *   CIC community statement) and falls back to enrichment. Reading only
 *   enrichment left every company — and every charity with filed activities but
 *   no enrichment row — generating from "Mission: Not provided".
 * - Sector and sub-sector prefer the canonical ORGANISATIONS columns, falling
 *   back to enrichment, the same resolution the booklet applies.
 */
export function toStageOneContext(input: {
  organisation: StageOneOrganisationRow;
  extras: StageOneExtras;
  senderName: string | null;
  attachFlyer: boolean;
}): StageOneContext {
  const { organisation, extras, senderName, attachFlyer } = input;
  const { contact, enrichment } = extras;
  return {
    organisationName: organisation.legal_name,
    tradingName: organisation.trading_name,
    organisationType: organisation.organisation_type,
    website: organisation.website,
    city: organisation.city,
    countryCode: organisation.country_code,
    geographicReach: organisation.geographic_reach,
    incomeBand: extras.incomeBand,
    contactName: contact ? [contact.first_name, contact.last_name].filter(Boolean).join(" ") || null : null,
    contactJobTitle: contact?.job_title ?? null,
    missionStatement: resolveMissionText({
      charity_activities: organisation.charity_activities,
      cic_community_statement: organisation.cic_community_statement,
      enrichment_mission: enrichment?.mission_statement,
    }),
    missionKeywords: enrichment?.mission_keywords ?? null,
    sector: organisation.sector?.trim() || enrichment?.sector || null,
    subSector: organisation.sub_sector?.trim() || enrichment?.sub_sector || null,
    newsHooks: enrichment?.news_hooks ?? null,
    booklet: extras.booklet,
    senderName,
    attachFlyer,
    attachmentText: extras.attachmentText,
  };
}
