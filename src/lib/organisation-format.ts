/**
 * Small display formatters shared by anything that renders an ORGANISATIONS row —
 * originally the F051 charity list (visible-clients.ts, which re-exports these for
 * its existing callers), now also the F068 client detail basic-info section
 * (client-basic-info.ts). Kept dependency-free so both can import it under plain
 * `node --test` without a bundler resolving path aliases.
 */

/** City if we have one, otherwise the ISO country code — country_code is never null. */
export function formatLocation(organisation: { city: string | null; country_code: string }): string {
  return organisation.city?.trim() || organisation.country_code;
}

/**
 * Known UK cities and large towns mapped to their ceremonial county or region.
 * Keys are lowercased and trimmed for robust matching.
 */
export const UK_CITY_REGIONS: Record<string, string> = {
  // South Yorkshire
  sheffield: "South Yorkshire",
  rotherham: "South Yorkshire",
  barnsley: "South Yorkshire",
  doncaster: "South Yorkshire",

  // West Yorkshire
  leeds: "West Yorkshire",
  bradford: "West Yorkshire",
  wakefield: "West Yorkshire",
  huddersfield: "West Yorkshire",
  halifax: "West Yorkshire",
  keighley: "West Yorkshire",
  dewsbury: "West Yorkshire",

  // North Yorkshire & Humber
  york: "North Yorkshire",
  harrogate: "North Yorkshire",
  scarborough: "North Yorkshire",
  ripon: "North Yorkshire",
  hull: "East Riding of Yorkshire",
  "kingston upon hull": "East Riding of Yorkshire",
  grimsby: "Lincolnshire",
  scunthorpe: "Lincolnshire",

  // Greater Manchester
  manchester: "Greater Manchester",
  salford: "Greater Manchester",
  bolton: "Greater Manchester",
  bury: "Greater Manchester",
  oldham: "Greater Manchester",
  rochdale: "Greater Manchester",
  stockport: "Greater Manchester",
  tameside: "Greater Manchester",
  trafford: "Greater Manchester",
  wigan: "Greater Manchester",
  altrincham: "Greater Manchester",
  sale: "Greater Manchester",

  // Merseyside & Cheshire
  liverpool: "Merseyside",
  birkenhead: "Merseyside",
  "st helens": "Merseyside",
  "st. helens": "Merseyside",
  southport: "Merseyside",
  chester: "Cheshire",
  warrington: "Cheshire",
  crewe: "Cheshire",
  runcorn: "Cheshire",
  widnes: "Cheshire",
  macclesfield: "Cheshire",

  // West Midlands
  birmingham: "West Midlands",
  coventry: "West Midlands",
  wolverhampton: "West Midlands",
  solihull: "West Midlands",
  walsall: "West Midlands",
  dudley: "West Midlands",
  sandwell: "West Midlands",
  "west bromwich": "West Midlands",
  "sutton coldfield": "West Midlands",
  "stoke-on-trent": "Staffordshire",
  "stoke on trent": "Staffordshire",
  stafford: "Staffordshire",
  shrewsbury: "Shropshire",
  telford: "Shropshire",
  worcester: "Worcestershire",
  hereford: "Herefordshire",

  // East Midlands
  nottingham: "Nottinghamshire",
  mansfield: "Nottinghamshire",
  derby: "Derbyshire",
  chesterfield: "Derbyshire",
  leicester: "Leicestershire",
  loughborough: "Leicestershire",
  northampton: "Northamptonshire",
  kettering: "Northamptonshire",
  corby: "Northamptonshire",
  lincoln: "Lincolnshire",

  // North East & Cumbria
  newcastle: "Tyne and Wear",
  "newcastle upon tyne": "Tyne and Wear",
  sunderland: "Tyne and Wear",
  gateshead: "Tyne and Wear",
  "south shields": "Tyne and Wear",
  middlesbrough: "North Yorkshire",
  durham: "County Durham",
  darlington: "County Durham",
  hartlepool: "County Durham",
  carlisle: "Cumbria",

  // London & Home Counties
  london: "Greater London",
  westminster: "Greater London",
  croydon: "Greater London",
  "st albans": "Hertfordshire",
  "st. albans": "Hertfordshire",
  watford: "Hertfordshire",
  stevenage: "Hertfordshire",
  chelmsford: "Essex",
  colchester: "Essex",
  "southend-on-sea": "Essex",
  "southend on sea": "Essex",
  guildford: "Surrey",
  woking: "Surrey",
  reading: "Berkshire",
  slough: "Berkshire",
  windsor: "Berkshire",
  "milton keynes": "Buckinghamshire",
  oxford: "Oxfordshire",

  // East of England
  norwich: "Norfolk",
  cambridge: "Cambridgeshire",
  peterborough: "Cambridgeshire",
  ipswich: "Suffolk",
  luton: "Bedfordshire",
  bedford: "Bedfordshire",

  // South & South East
  brighton: "East Sussex",
  "brighton and hove": "East Sussex",
  "brighton & hove": "East Sussex",
  hove: "East Sussex",
  eastbourne: "East Sussex",
  hastings: "East Sussex",
  crawley: "West Sussex",
  chichester: "West Sussex",
  worthing: "West Sussex",
  southampton: "Hampshire",
  portsmouth: "Hampshire",
  winchester: "Hampshire",
  canterbury: "Kent",
  maidstone: "Kent",

  // South West
  bristol: "Bristol",
  bath: "Somerset",
  plymouth: "Devon",
  exeter: "Devon",
  torquay: "Devon",
  gloucester: "Gloucestershire",
  cheltenham: "Gloucestershire",
  swindon: "Wiltshire",
  salisbury: "Wiltshire",
  bournemouth: "Dorset",
  poole: "Dorset",

  // Scotland
  edinburgh: "Midlothian",
  glasgow: "Greater Glasgow",
  aberdeen: "Aberdeenshire",
  dundee: "Angus",
  inverness: "Highlands",
  stirling: "Stirlingshire",
  perth: "Perth and Kinross",

  // Wales
  cardiff: "South Wales",
  swansea: "South Wales",
  newport: "South Wales",
  wrexham: "North Wales",
  bangor: "North Wales",

  // Northern Ireland
  belfast: "County Antrim",
  derry: "County Londonderry",
  londonderry: "County Londonderry",
  lisburn: "County Antrim",
  newry: "County Down",
};

/**
 * Formats a city name with its region/county if recognised (e.g. "Sheffield, South Yorkshire").
 * If the city already specifies a region (e.g. has a comma) or if the region is the same
 * as the city name, it returns the city name directly.
 */
export function formatCityWithRegion(city: string): string {
  const trimmed = city.trim();
  if (!trimmed) return "";

  // If already formatted with a region/comma, return as-is
  if (trimmed.includes(",")) return trimmed;

  const lookupKey = trimmed.toLowerCase();
  const region = UK_CITY_REGIONS[lookupKey];

  if (region && lookupKey !== region.toLowerCase()) {
    return `${trimmed}, ${region}`;
  }

  return trimmed;
}

/** "not_started" -> "Not started". */
export function formatOutreachStatus(status: string): string {
  const spaced = status.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** F145/F146-F155 — the ten pipeline statuses a client can be in, in the order the
 * tickets define them. `not_contacted` (F146) is the default for a new client. */
export const PIPELINE_STATUSES = [
  "not_contacted",
  "initial_outreach_sent",
  "follow_up_sent",
  "responded",
  "converted",
  "future_potential",
  "soft_no",
  "hard_no",
  "no_response",
  "loss_due_timing",
] as const;

export type PipelineStatus = (typeof PIPELINE_STATUSES)[number];

/** F041/F053 — the standardised `organisation_type` values, and how each is
 * written in the UI. Expanded from four (charity/company/both/other) to eight
 * so CAMs can filter to specific types (charity, NGO, social enterprise, CIC,
 * CIO etc.) via the F041 field. The list is the filter's option set, so the
 * options can never drift from the values the column actually allows (F053 AC3).
 * "both" means registered as a charity *and* as a company, not a third kind. */
export const ORGANISATION_TYPES = [
  "charity",
  "cio",
  "cic",
  "social_enterprise",
  "ngo",
  "company",
  "both",
  "other",
] as const;

export type OrganisationType = (typeof ORGANISATION_TYPES)[number];

const ORGANISATION_TYPE_LABELS: Record<string, string> = {
  charity: "Charity",
  cio: "CIO",
  cic: "CIC",
  social_enterprise: "Social enterprise",
  ngo: "NGO",
  company: "Company",
  both: "Charity and company",
  other: "Other",
};

/** Falls back to the raw value rather than hiding it: a type the database grew
 * before this file heard about it should read oddly, not vanish. */
export function formatOrganisationType(type: string): string {
  return ORGANISATION_TYPE_LABELS[type] ?? type;
}
