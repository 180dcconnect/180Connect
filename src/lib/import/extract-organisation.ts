// Turns one fetched page into the fields F037 can offer a CAM for review.
//
// Pure function, no network, no database — same reasoning as the F041 source mappers
// (standardize/charity-commission.ts) and F042's matcher: the part that can be wrong
// in interesting ways is the part that must be assertable without a fixture server.
// Every branch below has a test in extract-organisation.test.ts built from the markup
// shapes real charity sites actually use.
//
// No LLM, and no headless browser. Three reasons, in order of weight:
//
//   1. Most of the value is not in the prose. It is in the identifiers — a charity or
//      company number in the footer turns an unreliable page scrape into an
//      authoritative registry lookup (see registry-lookup.ts). Those identifiers are
//      formatted by law, so a regex reads them as well as anything could.
//   2. What the page states about itself is unverified either way. A model that
//      infers a mission statement from body copy produces something fluent and
//      unattributable; a description the site wrote about itself is at least a quote.
//   3. The CAM confirms every field before it is saved (AC9), so precision matters
//      more than recall. Leaving a field blank costs a CAM one line of typing.
//      Filling it with a confident guess costs a wrong record nobody re-checks.
//
// A JavaScript-rendered site yields little here. That is handled, not worked around:
// it becomes an "insufficient information" outcome the CAM is told about (F256).

/** UK-format postcode, as printed. Deliberately not validated against the real list. */
const UK_POSTCODE = /\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\b/i;

const EMAIL = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;

/**
 * The registers a UK organisation can appear on, and what a number on each looks like.
 *
 * England and Wales numbers are bare digits, so they are only recognised next to
 * wording that says what they are — a loose \d{6,7} would match a phone number, a
 * date range or a donation amount. Scotland and Northern Ireland prefix theirs, which
 * is both self-identifying and the reason they are worth separating: they are
 * different registers with different APIs, and sending an OSCR number to the Charity
 * Commission returns a confident answer about the wrong charity.
 */
export type CharityRegister = "england_and_wales" | "scotland" | "northern_ireland";

export const CHARITY_REGISTRY_NAMES: Readonly<Record<CharityRegister, string>> = {
  england_and_wales: "Charity Commission for England and Wales",
  scotland: "Office of the Scottish Charity Regulator",
  northern_ireland: "Charity Commission for Northern Ireland",
};

export type ExtractedCharityNumber = { register: CharityRegister; number: string };

export type WebsiteExtraction = {
  legalName: string | null;
  missionStatement: string | null;
  contactEmail: string | null;
  addressLine1: string | null;
  city: string | null;
  postcode: string | null;
  countryCode: string | null;
  charity: ExtractedCharityNumber | null;
  /** Companies House number, normalised to 8 characters. */
  companyNumber: string | null;
  website: string | null;
  socialLinks: string[];
};

const EMPTY_EXTRACTION: WebsiteExtraction = {
  legalName: null,
  missionStatement: null,
  contactEmail: null,
  addressLine1: null,
  city: null,
  postcode: null,
  countryCode: null,
  charity: null,
  companyNumber: null,
  website: null,
  socialLinks: [],
};

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  rsquo: "’",
  lsquo: "‘",
  ldquo: "“",
  rdquo: "”",
  hellip: "…",
  pound: "£",
};

export function decodeEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, body: string) => {
    if (body.startsWith("#")) {
      const codePoint = body[1]?.toLowerCase() === "x"
        ? Number.parseInt(body.slice(2), 16)
        : Number.parseInt(body.slice(1), 10);
      return Number.isFinite(codePoint) && codePoint > 0 && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : match;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? match;
  });
}

function collapse(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function clean(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const text = collapse(decodeEntities(value));
  if (!text) return null;
  return text.length > maxLength ? text.slice(0, maxLength).trimEnd() : text;
}

/** Body text with script, style, and markup removed. Used only for the footer patterns. */
export function visibleText(html: string): string {
  const withoutCode = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
  return collapse(decodeEntities(withoutCode.replace(/<[^>]+>/g, " ")));
}

function metaContent(html: string, ...names: string[]): string | null {
  for (const name of names) {
    // Attribute order varies, so match the tag then read its attributes, rather than
    // assuming content follows name.
    const pattern = new RegExp(
      `<meta\\b[^>]*?(?:name|property)\\s*=\\s*["']${name}["'][^>]*>`,
      "i",
    );
    const tag = html.match(pattern)?.[0];
    // The closing quote is matched back to the opening one. Without the backreference
    // a double-quoted description ends at its first apostrophe, so "We're Mind, the
    // mental health charity" imports as "We" — confirmed against mind.org.uk.
    const content = tag?.match(/content\s*=\s*(["'])([\s\S]*?)\1/i)?.[2];
    const value = clean(content, 5000);
    if (value) return value;
  }
  return null;
}

type JsonLdNode = Record<string, unknown>;

const ORGANISATION_TYPES = new Set([
  "organization",
  "organisation",
  "ngo",
  "nonprofit",
  "nonprofitorganization",
  "corporation",
  "localbusiness",
  "educationalorganization",
  "charitableorganization",
]);

/** Flattens @graph and arrays so a node is found wherever the site chose to put it. */
function collectNodes(value: unknown, into: JsonLdNode[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collectNodes(item, into);
    return;
  }
  if (!value || typeof value !== "object") return;
  const node = value as JsonLdNode;
  into.push(node);
  if ("@graph" in node) collectNodes(node["@graph"], into);
}

function nodeType(node: JsonLdNode): string[] {
  const raw = node["@type"];
  const values = Array.isArray(raw) ? raw : [raw];
  return values
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.split("/").pop()!.toLowerCase());
}

/**
 * The organisation node from the page's structured data, if it published one.
 *
 * This is the highest-quality source on the page by a wide margin: it is the site's
 * own machine-readable statement of who it is, rather than something inferred from
 * how the page looks. A malformed block is skipped rather than throwing — a broken
 * JSON-LD script must not cost the CAM the rest of the import.
 */
export function findOrganisationNode(html: string): JsonLdNode | null {
  const blocks = html.matchAll(
    /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/gi,
  );
  const nodes: JsonLdNode[] = [];

  for (const block of blocks) {
    try {
      collectNodes(JSON.parse(decodeEntities(block[1])), nodes);
    } catch {
      continue;
    }
  }

  return nodes.find((node) => nodeType(node).some((type) => ORGANISATION_TYPES.has(type))) ?? null;
}

function addressFrom(node: JsonLdNode | null): {
  addressLine1: string | null;
  city: string | null;
  postcode: string | null;
  countryCode: string | null;
} {
  const raw = node?.address;
  const address = (Array.isArray(raw) ? raw[0] : raw) as JsonLdNode | undefined;
  if (!address || typeof address !== "object") {
    return { addressLine1: null, city: null, postcode: null, countryCode: null };
  }

  const country = address.addressCountry;
  const countryValue = typeof country === "object" && country !== null
    ? (country as JsonLdNode).name
    : country;
  const countryText = clean(countryValue, 60);

  // Sites routinely put the whole tail of the address in addressLocality — the
  // British Heart Foundation publishes "London, United Kingdom" — and ORGANISATIONS
  // keeps the town in its own column. Everything after the first comma is the part
  // that belongs elsewhere.
  const locality = clean(address.addressLocality, 200)?.split(",")[0].trim() || null;

  return {
    addressLine1: clean(address.streetAddress, 300),
    city: locality,
    postcode: clean(address.postalCode, 32)?.toUpperCase() ?? null,
    countryCode: normaliseCountry(countryText),
  };
}

/** Two-letter code, accepting the handful of full names a UK site actually writes. */
export function normaliseCountry(value: string | null): string | null {
  if (!value) return null;
  const text = value.trim().toLowerCase();
  // Named forms are checked before the two-letter shortcut, or "UK" — which is not
  // the ISO code for the United Kingdom — would pass straight through as "UK".
  if (/united kingdom|great britain|^uk$|^gb$|england|scotland|wales|northern ireland/.test(text)) {
    return "GB";
  }
  if (/^ireland$|republic of ireland/.test(text)) return "IE";
  if (/united states|^usa$/.test(text)) return "US";
  if (/^[a-z]{2}$/.test(text)) return text.toUpperCase();
  return null;
}

const SOCIAL_HOSTS = [
  "linkedin.com",
  "twitter.com",
  "x.com",
  "facebook.com",
  "instagram.com",
  "youtube.com",
  "bsky.app",
  "mastodon.social",
];

function socialLinksFrom(html: string, node: JsonLdNode | null): string[] {
  const candidates = new Set<string>();

  const sameAs = node?.sameAs;
  for (const value of Array.isArray(sameAs) ? sameAs : [sameAs]) {
    if (typeof value === "string") candidates.add(value.trim());
  }

  for (const match of html.matchAll(/href\s*=\s*["'](https?:\/\/[^"']+)["']/gi)) {
    candidates.add(decodeEntities(match[1]));
  }

  const found = new Map<string, string>();
  for (const candidate of candidates) {
    let host: string;
    let url: URL;
    try {
      url = new URL(candidate);
      host = url.hostname.replace(/^www\./, "").toLowerCase();
    } catch {
      continue;
    }
    const platform = SOCIAL_HOSTS.find((social) => host === social || host.endsWith(`.${social}`));
    // A bare platform homepage in a "follow us" block is not a profile; require a path.
    if (!platform || url.pathname.replace(/\/+$/, "").length === 0) continue;
    if (!found.has(platform)) found.set(platform, url.toString());
  }

  return [...found.values()];
}

/**
 * A charity registration number, with the register it belongs to.
 *
 * The wording requirement on England and Wales numbers is the whole point: bare
 * six-and-seven-digit runs are everywhere on a charity website (phone numbers,
 * "£1,250,000 raised", "since 1984"). Matching only next to an explicit statement of
 * what the number is costs some recall on badly-worded footers and buys the CAM a
 * field they can trust without cross-checking.
 */
export function findCharityNumber(text: string): ExtractedCharityNumber | null {
  // England and Wales is tried first, and that order is load-bearing. A charity
  // registered in more than one nation prints all of its numbers together — the
  // British Heart Foundation's footer reads "registered charity in England and Wales
  // (225971), Scotland (SC039426)". The Scottish number is easier to spot because it
  // is prefixed, so a prefix-first search returns the one register this platform
  // cannot query and never sees the one it can.
  for (const pattern of [
    // "Registered charity number 225971", "Charity no. 225971", "charity #225971"
    /\b(?:registered\s+)?charity(?:\s+(?:registration|registered))?\s*(?:number|no\.?|#)?[:\s]*\(?(\d{6,7})\)?\b/i,
    // "registered charity in England and Wales (225971)"
    /\bcharity\b[^.]{0,40}?\b(?:england(?:\s+(?:and|&)\s+wales)?|e&w)\b[^.]{0,20}?\(?(\d{6,7})\)?\b/i,
    // "225971 is our registered charity number"
    /\b(\d{6,7})\b[^.]{0,20}?\bregistered\s+charity\b/i,
  ]) {
    const match = text.match(pattern);
    if (match) return { register: "england_and_wales", number: match[1] };
  }

  const prefixed = text.match(/\b(SC|NIC?)\s?0*(\d{5,6})\b/i);
  if (prefixed) {
    const scottish = prefixed[1].toUpperCase().startsWith("SC");
    return {
      register: scottish ? "scotland" : "northern_ireland",
      number: scottish
        ? `SC${prefixed[2].padStart(6, "0")}`
        : `NIC${prefixed[2].padStart(6, "0")}`,
    };
  }

  return null;
}

/**
 * A Companies House number: eight digits, or a two-letter prefix and six digits.
 *
 * Shorter all-digit numbers are real and are zero-padded to eight, which is how
 * Companies House itself stores them — 12345 is 00012345 and nothing else will match.
 */
export function findCompanyNumber(text: string): string | null {
  const stated = text.match(
    /\bcompan(?:y|ies)(?:\s+house)?\s*(?:registration\s*)?(?:number|no\.?|reg\.?|#)[:\s]*([A-Z]{2}\d{6}|\d{4,8})\b/i,
  );
  if (stated) return normaliseCompanyNumber(stated[1]);

  const registeredIn = text.match(
    /\bregistered\s+in\s+(?:england(?:\s+and\s+wales)?|scotland|wales|northern\s+ireland)[^.]{0,40}?\b(?:number|no\.?|#)?\s*([A-Z]{2}\d{6}|\d{6,8})\b/i,
  );
  if (registeredIn) return normaliseCompanyNumber(registeredIn[1]);

  return null;
}

function normaliseCompanyNumber(value: string): string {
  const trimmed = value.trim().toUpperCase();
  return /^\d+$/.test(trimmed) ? trimmed.padStart(8, "0") : trimmed;
}

/** Strips the site-name and tagline furniture from a <title>, leaving the name. */
export function nameFromTitle(title: string): string | null {
  const [first] = title.split(/\s+[|·—–-]\s+/);
  const candidate = clean(first, 200);
  if (!candidate) return null;
  // "Home", "Welcome" and friends are the page, not the organisation.
  if (/^(home|homepage|welcome|about(\s+us)?|index)$/i.test(candidate)) {
    const parts = title.split(/\s+[|·—–-]\s+/).slice(1);
    return clean(parts.join(" "), 200);
  }
  return candidate;
}

function emailFrom(html: string, node: JsonLdNode | null): string | null {
  const declared = clean(node?.email, 320);
  if (declared) return declared.replace(/^mailto:/i, "").toLowerCase();

  const mailto = html.match(/href\s*=\s*["']mailto:([^"'?]+)/i)?.[1];
  const fromLink = clean(mailto, 320)?.toLowerCase();
  if (fromLink && EMAIL.test(fromLink)) return fromLink;

  // Last resort: an address printed in the body. Prefer a role inbox — "info@",
  // "contact@" and the like are the organisation's, where a named address is a
  // person's, and a person's inbox is not what this platform is collecting.
  const candidates = [...visibleText(html).matchAll(new RegExp(EMAIL, "gi"))].map(
    (match) => match[0].toLowerCase(),
  );
  const role = candidates.find((address) =>
    /^(info|contact|hello|enquiries|enquiry|admin|office|mail|team|general)@/.test(address),
  );
  return role ?? null;
}

/**
 * Reads what the page says about the organisation that owns it.
 *
 * Ordering is always structured data, then metadata, then body text: earliest is
 * most deliberate, and something the site published for machines beats something
 * this function guessed from prose.
 */
export function extractOrganisation(html: string, finalUrl: string): WebsiteExtraction {
  if (!html.trim()) return EMPTY_EXTRACTION;

  const node = findOrganisationNode(html);
  const text = visibleText(html);
  const title = clean(html.match(/<title[^>]*>([\s\S]*?)<\/title\s*>/i)?.[1], 300);

  const legalName = clean(node?.legalName, 200)
    ?? clean(node?.name, 200)
    ?? metaContent(html, "og:site_name")
    ?? (title ? nameFromTitle(title) : null);

  const missionStatement = clean(node?.description, 5000)
    ?? metaContent(html, "og:description", "description", "twitter:description");

  const address = addressFrom(node);
  const postcodeMatch = text.match(UK_POSTCODE);
  const postcode = address.postcode
    ?? (postcodeMatch ? `${postcodeMatch[1]} ${postcodeMatch[2]}`.toUpperCase() : null);

  const charity = findCharityNumber(text);
  const companyNumber = findCompanyNumber(text);

  let website: string | null = null;
  try {
    website = new URL(finalUrl).origin;
  } catch {
    website = null;
  }

  return {
    legalName,
    missionStatement,
    contactEmail: emailFrom(html, node),
    addressLine1: address.addressLine1,
    city: address.city,
    postcode,
    // A UK register number or a UK postcode is stronger evidence of country than
    // anything else on a page, and most sites never state a country at all.
    countryCode: address.countryCode
      ?? (charity || companyNumber || postcode ? "GB" : null),
    charity,
    companyNumber,
    website,
    socialLinks: socialLinksFrom(html, node),
  };
}

/**
 * Whether there is enough here to be worth showing the CAM (F037 AC10, F256).
 *
 * The bar is a name plus one thing that identifies which organisation it is. A page
 * that yields only a name has told us nothing a CAM could not type faster themselves,
 * and offering it as an import invites confirming a record built from a page title.
 */
export function isImportUsable(extraction: WebsiteExtraction): boolean {
  if (!extraction.legalName) return false;
  return Boolean(
    extraction.charity
    || extraction.companyNumber
    || extraction.postcode
    || extraction.contactEmail,
  );
}
