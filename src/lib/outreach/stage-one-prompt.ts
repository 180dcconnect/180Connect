export type StageOneContext = {
  organisationName: string;
  organisationType: string;
  website?: string | null;
  city?: string | null;
  countryCode?: string | null;
  contactName?: string | null;
  contactJobTitle?: string | null;
  missionStatement?: string | null;
  missionKeywords?: string[] | null;
  sector?: string | null;
  subSector?: string | null;
  newsHooks?: string[] | null;
};

export const EMAIL_LENGTHS = ["short", "standard", "detailed"] as const;
export type EmailLength = (typeof EMAIL_LENGTHS)[number];
export const EMAIL_VOICES = ["180dc", "consultative", "plain_language"] as const;
export type EmailVoice = (typeof EMAIL_VOICES)[number];

const LENGTH_INSTRUCTIONS: Record<EmailLength, string> = {
  short: "Keep the body between 70 and 100 words, with no more than three short paragraphs.",
  standard: "Keep the body between 130 and 170 words, with clear, readable paragraphs.",
  detailed: "Keep the body between 200 and 260 words, adding useful context without repetition.",
};

const VOICE_INSTRUCTIONS: Record<EmailVoice, string> = {
  "180dc": "Use 180DC Sheffield's collective voice: capable, collaborative and socially minded; write as 'we'.",
  consultative: "Use a consultative voice: curious, thoughtful and focused on understanding the charity before suggesting solutions; write as 'we'.",
  plain_language: "Use a plain-language voice: direct, accessible and free of consultancy jargon; write as 'we'.",
};

function value(value: string | null | undefined): string {
  return value?.trim() || "Not provided";
}

function values(items: string[] | null | undefined): string {
  return items?.filter(Boolean).join(", ") || "Not provided";
}

export function buildStageOnePrompt(
  context: StageOneContext,
  options: { length?: EmailLength; voice?: EmailVoice } = {},
) {
  const length = options.length ?? "standard";
  const voice = options.voice ?? "180dc";
  return {
    system: `You draft initial charity outreach emails for 180 Degrees Consulting Sheffield.
Use only facts supplied in the client context. Never invent achievements, needs, people, partnerships, or news.
Write a concise, warm and professional first-contact email. Explain that 180 Degrees Consulting Sheffield is a student-led consultancy supporting socially minded organisations. Do not promise outcomes or imply an existing relationship.
${LENGTH_INSTRUCTIONS[length]}
${VOICE_INSTRUCTIONS[voice]}
Return exactly one JSON object with two string properties: "subject" and "body". Do not use markdown fences. The body must be plain text and must not include a sender signature.`,
    prompt: `Draft a Stage 1 outreach email using this reviewed client context.

Organisation: ${value(context.organisationName)}
Organisation type: ${value(context.organisationType)}
Website: ${value(context.website)}
Location: ${[context.city, context.countryCode].filter(Boolean).join(", ") || "Not provided"}
Primary contact: ${value(context.contactName)}
Contact role: ${value(context.contactJobTitle)}

Client booklet/profile context:
Mission: ${value(context.missionStatement)}
Mission themes: ${values(context.missionKeywords)}
Sector: ${value(context.sector)}
Sub-sector: ${value(context.subSector)}
Relevant news hooks: ${values(context.newsHooks)}

If context is missing, write a useful general introduction using the organisation name; do not mention that data is missing.`,
  };
}
