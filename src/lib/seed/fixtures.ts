/**
 * Fake organisation records for development and testing (F233).
 *
 * Nothing here is derived from a real client. The data is *invented*, not
 * anonymised, which is the point: anonymised production data still carries the
 * GDPR obligations of the original records, and F233 AC1 requires developers to
 * work without touching real client data at all.
 *
 * Generation is deterministic — the same seed produces the same 50 rows on every
 * machine — so a bug reproduced against seed data reproduces for everyone, and the
 * tests can assert on exact output.
 *
 * Every row is marked twice over: `is_seed = true` (the queryable, deletable
 * marker required by F233 AC4) and, wherever the fields are populated at all,
 * the reserved `.seed.test` domain in `website` and `contact_email`. The
 * reserved-domain marker is deliberately *not* the primary one — roughly a third
 * of these rows have no email by design.
 */

/** Pipeline stages, exactly as defined by Data Model tab 04 ORGANISATIONS.outreach_status. */
export const OUTREACH_STATUSES = [
  "not_started",
  "queued",
  "contacted",
  "replied",
  "closed",
] as const;
export type OutreachStatus = (typeof OUTREACH_STATUSES)[number];

export type OrganisationType = "charity" | "company" | "both" | "other";
export type EntryMethod = "api" | "manual";
export type GeographicReach = "local" | "regional" | "national" | "international";

/** One generated organisation, shaped to match the ORGANISATIONS columns. */
export type SeedOrganisation = {
  legal_name: string;
  trading_name: string | null;
  country_code: string;
  is_international: boolean;
  entry_method: EntryMethod;
  is_verified: boolean;
  organisation_type: OrganisationType;
  website: string | null;
  contact_email: string | null;
  address_line_1: string | null;
  city: string | null;
  postcode: string | null;
  geographic_reach: GeographicReach | null;
  outreach_status: OutreachStatus;
  data_completeness_score: number;
  is_seed: true;
};

/** The reserved domain every generated URL and address sits under. */
export const SEED_DOMAIN = "seed.test";

/**
 * The optional profile fields `data_completeness_score` is measured over. The
 * required fields (legal_name, entry_method, organisation_type, ...) are always
 * present, so including them would compress every score into a narrow band and
 * tell a developer nothing.
 *
 * `trading_name` is excluded on purpose: most organisations legitimately trade
 * under their registered name, so its absence is not a gap in the profile. Scoring
 * it would mark the majority of complete records as incomplete.
 */
const SCORED_FIELDS = [
  "website",
  "contact_email",
  "address_line_1",
  "city",
  "postcode",
  "geographic_reach",
] as const;

export const DEFAULT_ORGANISATION_COUNT = 50;

/** Share of records that are deliberately missing profile fields (F233 AC3). */
export const INCOMPLETE_SHARE = 0.3;

/**
 * Small deterministic PRNG (mulberry32). `Math.random` cannot be seeded, and a
 * cryptographic generator is the wrong tool — this needs to be reproducible, not
 * unpredictable.
 */
function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(random: () => number, values: readonly T[]): T {
  return values[Math.floor(random() * values.length)];
}

const NAME_PREFIXES = [
  "Ashgrove", "Brambleton", "Calderwick", "Dunmore", "Eastvale", "Fernhill",
  "Granthorpe", "Hollybank", "Ivybridge", "Jesmond", "Kirkstall", "Larchmere",
  "Marlowe", "Northgate", "Oakhaven", "Pinefield", "Quarrydown", "Redbourne",
  "Stonecross", "Thornbury", "Underwood", "Vellacott", "Westmoor", "Yarrowdale",
  "Bythorne", "Colwyn", "Draycott", "Elmsworth",
];

const NAME_SUBJECTS = [
  "Youth", "Community", "Heritage", "Wellbeing", "Literacy", "Housing",
  "Environment", "Carers", "Arts", "Food", "Digital Skills", "Refugee Support",
  "Mental Health", "Family", "Sports", "Education",
];

const NAME_SUFFIXES = [
  "Trust", "Foundation", "Alliance", "Network", "Association", "Initiative",
  "Partnership", "Project", "Society", "Collective",
];

const UK_CITIES = [
  "Manchester", "Leeds", "Bristol", "Sheffield", "Nottingham", "Newcastle",
  "Cardiff", "Glasgow", "Birmingham", "Liverpool", "Brighton", "Norwich",
  "Plymouth", "Coventry", "Aberdeen", "Swansea",
];

const STREETS = [
  "Mill Lane", "Station Road", "Church Street", "Victoria Terrace", "Kiln Way",
  "Weavers Yard", "Old Foundry Road", "Bridgegate", "Harbour Walk", "Quarry Rise",
];

/** Non-GB countries, so international handling has something to exercise. */
const INTERNATIONAL_LOCATIONS = [
  { country_code: "IE", city: "Dublin" },
  { country_code: "NL", city: "Utrecht" },
  { country_code: "DE", city: "Leipzig" },
  { country_code: "ES", city: "Valencia" },
];

/** Turns a name into the label used in the reserved seed domain. */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Fraction of {@link SCORED_FIELDS} that are populated, rounded to 2 decimals. */
export function completenessScore(
  organisation: Omit<SeedOrganisation, "data_completeness_score">,
): number {
  const populated = SCORED_FIELDS.filter((field) => {
    const value = organisation[field];
    return value !== null && value !== "";
  }).length;
  return Math.round((populated / SCORED_FIELDS.length) * 100) / 100;
}

/**
 * Spreads `count` records over the pipeline stages as evenly as possible, giving
 * any remainder to the earliest stages. With the default 50 this is 10 per stage.
 */
export function distributeStatuses(count: number): OutreachStatus[] {
  return Array.from({ length: count }, (_, index) =>
    OUTREACH_STATUSES[index % OUTREACH_STATUSES.length],
  ).sort(
    (a, b) => OUTREACH_STATUSES.indexOf(a) - OUTREACH_STATUSES.indexOf(b),
  );
}

/**
 * The kinds of gap an incomplete record can have. Each incomplete record takes the
 * next combination in turn, so every one of these is guaranteed to appear — a
 * developer testing an empty state needs a row with no website, and separately a
 * row with no address at all.
 */
const MISSING_FIELD_COMBINATIONS: (typeof SCORED_FIELDS)[number][][] = [
  ["contact_email"],
  ["website"],
  ["address_line_1", "city", "postcode"],
  ["contact_email", "website"],
  ["contact_email", "website", "address_line_1", "city", "postcode"],
];

/**
 * Generates the seed organisations.
 *
 * @param count how many records to produce (default 50, per F233 AC3)
 * @param seed  PRNG seed; the same seed always yields the same records
 */
export function generateOrganisations(
  count: number = DEFAULT_ORGANISATION_COUNT,
  seed = 180_233,
): SeedOrganisation[] {
  const random = createRandom(seed);
  const statuses = distributeStatuses(count);
  const incompleteTarget = Math.round(count * INCOMPLETE_SHARE);

  // Incomplete records are placed on a regular stride through the list so they land
  // in every pipeline stage instead of bunching at one end. The combination is keyed
  // off the record's position in the incomplete set, not its index in the whole list:
  // striding through both at once would only ever hit a few of the combinations.
  const stride = count / incompleteTarget;
  const missingByIndex = new Map<number, Set<(typeof SCORED_FIELDS)[number]>>(
    Array.from({ length: incompleteTarget }, (_, n) => [
      Math.floor(n * stride),
      new Set(MISSING_FIELD_COMBINATIONS[n % MISSING_FIELD_COMBINATIONS.length]),
    ]),
  );

  const usedNames = new Set<string>();

  return Array.from({ length: count }, (_, index) => {
    let legalName = "";
    do {
      legalName =
        `${pick(random, NAME_PREFIXES)} ${pick(random, NAME_SUBJECTS)} ` +
        pick(random, NAME_SUFFIXES);
    } while (usedNames.has(legalName));
    usedNames.add(legalName);

    const slug = slugify(legalName);
    const missing =
      missingByIndex.get(index) ?? new Set<(typeof SCORED_FIELDS)[number]>();

    // Every fifth record is non-GB. is_international is derived from country_code,
    // not chosen independently — the table's check constraint enforces that.
    const international = index % 5 === 4;
    const location = international
      ? pick(random, INTERNATIONAL_LOCATIONS)
      : { country_code: "GB", city: pick(random, UK_CITIES) };

    const fields = {
      legal_name: legalName,
      // Most organisations trade under their registered name; a minority differ.
      trading_name: random() < 0.25 ? legalName.replace(/ (Trust|Foundation|Association)$/, "") : null,
      country_code: location.country_code,
      is_international: location.country_code !== "GB",
      entry_method: (random() < 0.8 ? "api" : "manual") as EntryMethod,
      // Manually entered records start unverified; API records usually verify.
      is_verified: random() < 0.7,
      organisation_type: pick<OrganisationType>(random, [
        "charity", "charity", "charity", "company", "both", "other",
      ]),
      website: missing.has("website") ? null : `https://www.${slug}.${SEED_DOMAIN}`,
      contact_email: missing.has("contact_email")
        ? null
        : `contact@${slug}.${SEED_DOMAIN}`,
      address_line_1: missing.has("address_line_1")
        ? null
        : `${1 + Math.floor(random() * 120)} ${pick(random, STREETS)}`,
      city: missing.has("city") ? null : location.city,
      // Non-GB records get a plain numeric code: a UK-format postcode on a Dutch
      // address would be a subtly wrong fixture, and postcode parsing is exactly
      // the kind of thing someone will test against this data.
      postcode: missing.has("postcode")
        ? null
        : international
          ? `${1000 + index * 7}`
          : `${["M", "LS", "BS", "S", "NG"][index % 5]}${1 + (index % 9)} ${
              1 + (index % 9)
            }${["AB", "CD", "EF", "GH"][index % 4]}`,
      geographic_reach: international
        ? ("international" as GeographicReach)
        : pick<GeographicReach>(random, ["local", "regional", "national"]),
      outreach_status: statuses[index],
      is_seed: true as const,
    };

    return { ...fields, data_completeness_score: completenessScore(fields) };
  });
}
