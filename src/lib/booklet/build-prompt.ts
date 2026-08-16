// F082 — Generate Client Booklet: the prompt itself, kept pure and DB-free so it's
// testable without a network call or Supabase — same reasoning as
// discrepancies/detect-field-discrepancies.ts's findFieldDiscrepancies.
//
// Field scope mirrors F083's own list (name, mission, type, sector, location) —
// the same six fields the client detail page's Basic Info section shows, not a
// wider read of financial_periods/grants/contacts. A missing field is written into
// the prompt as "Not provided", the same convention client-basic-info.ts uses for
// display, so the model sees the gap explicitly rather than a blank string it might
// paper over.

import { formatLocation } from "../organisation-format.ts";

const NOT_PROVIDED = "Not provided";

export type BookletOrganisationInput = {
  legal_name: string;
  organisation_type: string;
  website: string | null;
  city: string | null;
  country_code: string;
};

export type BookletEnrichmentInput = {
  mission_statement: string | null;
  mission_keywords: string[] | null;
  sector: string | null;
  sub_sector: string | null;
} | null;

function displayValue(value: string | null | undefined): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : NOT_PROVIDED;
}

function displayList(values: string[] | null | undefined): string {
  const cleaned = (values ?? []).map((v) => v.trim()).filter(Boolean);
  return cleaned.length > 0 ? cleaned.join(", ") : NOT_PROVIDED;
}

/**
 * Builds the system + user prompt for a booklet generation call. Output is a fixed
 * shape ({ system, prompt }) so generate-booklet.ts can hand it straight to the AI
 * SDK's generateText without reassembling anything.
 *
 * The system prompt is the guardrail against fabrication (F083 AC3, done cheaply
 * here even though F083 itself is out of scope this pass) and against runaway
 * length/cost (per the LLM Provider Research doc's own caution about capping
 * prompt/output size) — both independent of maxOutputTokens, which caps length at
 * the API level, not the model's own judgement of how much to say.
 */
export function buildBookletPrompt(
  organisation: BookletOrganisationInput,
  enrichment: BookletEnrichmentInput,
): { system: string; prompt: string } {
  const system = [
    "You write short research briefings for a charity-outreach CRM, read by a",
    "Charity Account Manager (CAM) preparing to contact a charity for the first time.",
    "Use only the facts given below. Never invent a name, statistic, activity, or",
    "detail that isn't present in the profile data — if something relevant is",
    "missing, say so plainly instead of guessing. Keep the whole booklet under",
    "roughly 250 words, in short paragraphs or plain dashes for lists. Plain text",
    "only — this is rendered as-is, with no markdown support. Never use asterisks,",
    "bold, italics, or # headers. For a section break, put a short label on its own",
    "line followed by a colon, e.g. \"Outreach angles:\", nothing else on that line.",
  ].join(" ");

  const prompt = [
    "Charity profile:",
    `- Name: ${displayValue(organisation.legal_name)}`,
    `- Type: ${displayValue(organisation.organisation_type)}`,
    `- Location: ${formatLocation(organisation)}`,
    `- Website: ${displayValue(organisation.website)}`,
    `- Mission: ${displayValue(enrichment?.mission_statement)}`,
    `- Mission keywords: ${displayList(enrichment?.mission_keywords)}`,
    `- Sector: ${displayValue(enrichment?.sector)}`,
    `- Sub-sector: ${displayValue(enrichment?.sub_sector)}`,
    "",
    "Write a concise research summary a CAM can read in under a minute before",
    "reaching out: who this charity is, what they do, and one or two relevant",
    "angles for an outreach conversation. If the profile is too sparse to say",
    "much, say that directly rather than padding it out.",
  ].join("\n");

  return { system, prompt };
}
