/**
 * UK City and Regional mappings to postcode areas for Companies House imports.
 *
 * The Companies House SQLite register indexes `postcode_area` (the 1-2 leading
 * letters, e.g. "M" for Manchester, "S" for Sheffield), which allows sub-millisecond
 * location filtering over 700k+ rows.
 *
 * Users naturally search and filter by city or region rather than raw postal prefixes.
 * This module maps friendly city and regional groups to their underlying postcode
 * areas, supporting both quick-select chips and name-based text resolution.
 */

import { normalisePostcodeArea } from "./filters.ts";

export type CityRegionZone =
  | "All"
  | "Yorkshire"
  | "North"
  | "Midlands"
  | "London & South"
  | "Wales & Scotland";

export type CityRegionPreset = {
  id: string;
  name: string;
  zone: Exclude<CityRegionZone, "All">;
  postcodeAreas: readonly string[];
  description?: string;
};

export const CITY_REGION_PRESETS: readonly CityRegionPreset[] = [
  // ── Yorkshire (180DC Sheffield local and surrounding areas) ───────────
  {
    id: "sheffield",
    name: "Sheffield",
    zone: "Yorkshire",
    postcodeAreas: ["S"],
    description: "Sheffield and South Yorkshire urban core",
  },
  {
    id: "south-yorkshire",
    name: "South Yorkshire",
    zone: "Yorkshire",
    postcodeAreas: ["S", "DN"],
    description: "Sheffield, Doncaster, Rotherham, Barnsley",
  },
  {
    id: "leeds",
    name: "Leeds",
    zone: "Yorkshire",
    postcodeAreas: ["LS"],
    description: "Leeds city area",
  },
  {
    id: "west-yorkshire",
    name: "West Yorkshire",
    zone: "Yorkshire",
    postcodeAreas: ["LS", "BD", "HD", "HX", "WF"],
    description: "Leeds, Bradford, Huddersfield, Halifax, Wakefield",
  },
  {
    id: "york",
    name: "York & North Yorkshire",
    zone: "Yorkshire",
    postcodeAreas: ["YO", "HG"],
    description: "York and Harrogate areas",
  },
  {
    id: "hull",
    name: "Hull & East Riding",
    zone: "Yorkshire",
    postcodeAreas: ["HU"],
    description: "Kingston upon Hull and East Riding",
  },
  {
    id: "all-yorkshire",
    name: "All Yorkshire",
    zone: "Yorkshire",
    postcodeAreas: ["S", "DN", "LS", "BD", "HD", "HX", "WF", "YO", "HG", "HU"],
    description: "Entire Yorkshire and the Humber region",
  },

  // ── North ─────────────────────────────────────────────────────────────
  {
    id: "manchester",
    name: "Manchester",
    zone: "North",
    postcodeAreas: ["M"],
    description: "Manchester city and central area",
  },
  {
    id: "greater-manchester",
    name: "Greater Manchester",
    zone: "North",
    postcodeAreas: ["M", "BL", "OL", "SK", "WN"],
    description: "Manchester, Bolton, Oldham, Stockport, Wigan",
  },
  {
    id: "liverpool",
    name: "Liverpool",
    zone: "North",
    postcodeAreas: ["L"],
    description: "Liverpool city area",
  },
  {
    id: "merseyside",
    name: "Merseyside",
    zone: "North",
    postcodeAreas: ["L", "CH", "WA"],
    description: "Liverpool, Wirral, St Helens, Southport",
  },
  {
    id: "newcastle",
    name: "Newcastle",
    zone: "North",
    postcodeAreas: ["NE"],
    description: "Newcastle upon Tyne",
  },
  {
    id: "north-east",
    name: "North East",
    zone: "North",
    postcodeAreas: ["NE", "SR", "DH", "DL", "TS"],
    description: "Newcastle, Sunderland, Durham, Darlington, Teesside",
  },
  {
    id: "lancashire",
    name: "Lancashire",
    zone: "North",
    postcodeAreas: ["PR", "BB", "FY", "LA"],
    description: "Preston, Blackburn, Blackpool, Lancaster",
  },
  {
    id: "cheshire",
    name: "Cheshire",
    zone: "North",
    postcodeAreas: ["CH", "CW", "WA"],
    description: "Chester, Crewe, Warrington",
  },

  // ── Midlands ──────────────────────────────────────────────────────────
  {
    id: "birmingham",
    name: "Birmingham",
    zone: "Midlands",
    postcodeAreas: ["B"],
    description: "Birmingham city area",
  },
  {
    id: "west-midlands",
    name: "West Midlands",
    zone: "Midlands",
    postcodeAreas: ["B", "CV", "DY", "WS", "WV"],
    description: "Birmingham, Coventry, Dudley, Walsall, Wolverhampton",
  },
  {
    id: "nottingham",
    name: "Nottingham",
    zone: "Midlands",
    postcodeAreas: ["NG"],
    description: "Nottingham area",
  },
  {
    id: "leicester",
    name: "Leicester",
    zone: "Midlands",
    postcodeAreas: ["LE"],
    description: "Leicester area",
  },
  {
    id: "derby",
    name: "Derby",
    zone: "Midlands",
    postcodeAreas: ["DE"],
    description: "Derby area",
  },
  {
    id: "stoke",
    name: "Stoke-on-Trent",
    zone: "Midlands",
    postcodeAreas: ["ST"],
    description: "Stoke-on-Trent & Staffordshire",
  },

  // ── London & South ────────────────────────────────────────────────────
  {
    id: "london-central",
    name: "London (Inner)",
    zone: "London & South",
    postcodeAreas: ["E", "EC", "N", "NW", "SE", "SW", "W", "WC"],
    description: "Central and Inner London postal districts",
  },
  {
    id: "london-greater",
    name: "Greater London (Outer)",
    zone: "London & South",
    postcodeAreas: ["BR", "CR", "DA", "EN", "HA", "IG", "KT", "RM", "SM", "TW", "UB", "WD"],
    description: "Outer London boroughs and postal districts",
  },
  {
    id: "all-london",
    name: "All London",
    zone: "London & South",
    postcodeAreas: [
      "E", "EC", "N", "NW", "SE", "SW", "W", "WC",
      "BR", "CR", "DA", "EN", "HA", "IG", "KT", "RM", "SM", "TW", "UB", "WD",
    ],
    description: "Inner and Outer London combined",
  },
  {
    id: "bristol",
    name: "Bristol & Bath",
    zone: "London & South",
    postcodeAreas: ["BS", "BA"],
    description: "Bristol, Bath and North Somerset",
  },
  {
    id: "oxford",
    name: "Oxford",
    zone: "London & South",
    postcodeAreas: ["OX"],
    description: "Oxford and Oxfordshire",
  },
  {
    id: "cambridge",
    name: "Cambridge",
    zone: "London & South",
    postcodeAreas: ["CB"],
    description: "Cambridge and Cambridgeshire",
  },
  {
    id: "southampton-portsmouth",
    name: "Southampton & Portsmouth",
    zone: "London & South",
    postcodeAreas: ["SO", "PO"],
    description: "South coast Hampshire",
  },
  {
    id: "brighton",
    name: "Brighton & Sussex",
    zone: "London & South",
    postcodeAreas: ["BN", "TN", "RH"],
    description: "Brighton, Redhill, Tunbridge Wells",
  },

  // ── Wales & Scotland ──────────────────────────────────────────────────
  {
    id: "cardiff",
    name: "Cardiff & South Wales",
    zone: "Wales & Scotland",
    postcodeAreas: ["CF", "NP", "SA"],
    description: "Cardiff, Newport, Swansea",
  },
  {
    id: "edinburgh",
    name: "Edinburgh",
    zone: "Wales & Scotland",
    postcodeAreas: ["EH"],
    description: "Edinburgh and Lothians",
  },
  {
    id: "glasgow",
    name: "Glasgow",
    zone: "Wales & Scotland",
    postcodeAreas: ["G", "PA", "ML"],
    description: "Glasgow, Paisley, Motherwell",
  },
  {
    id: "belfast",
    name: "Northern Ireland",
    zone: "Wales & Scotland",
    postcodeAreas: ["BT"],
    description: "All Northern Ireland (Belfast)",
  },
];

/**
 * Common city and town aliases mapped to their primary postcode area(s).
 */
const CITY_ALIASES: Record<string, readonly string[]> = {
  // Cities
  manchester: ["M"],
  "greater manchester": ["M", "BL", "OL", "SK", "WN"],
  salford: ["M"],
  bolton: ["BL"],
  oldham: ["OL"],
  stockport: ["SK"],
  wigan: ["WN"],
  rochdale: ["OL"],
  bury: ["BL"],

  sheffield: ["S"],
  "south yorkshire": ["S", "DN"],
  doncaster: ["DN"],
  rotherham: ["S"],
  barnsley: ["S"],
  chesterfield: ["S"],

  leeds: ["LS"],
  bradford: ["BD"],
  huddersfield: ["HD"],
  halifax: ["HX"],
  wakefield: ["WF"],
  "west yorkshire": ["LS", "BD", "HD", "HX", "WF"],
  york: ["YO"],
  harrogate: ["HG"],
  hull: ["HU"],
  "kingston upon hull": ["HU"],

  birmingham: ["B"],
  "west midlands": ["B", "CV", "DY", "WS", "WV"],
  coventry: ["CV"],
  wolverhampton: ["WV"],
  walsall: ["WS"],
  dudley: ["DY"],
  nottingham: ["NG"],
  leicester: ["LE"],
  derby: ["DE"],
  stoke: ["ST"],
  "stoke-on-trent": ["ST"],

  liverpool: ["L"],
  merseyside: ["L", "CH", "WA"],
  wirral: ["CH"],
  chester: ["CH"],
  warrington: ["WA"],
  preston: ["PR"],
  blackpool: ["FY"],
  blackburn: ["BB"],
  lancaster: ["LA"],

  newcastle: ["NE"],
  "newcastle upon tyne": ["NE"],
  sunderland: ["SR"],
  durham: ["DH"],
  darlington: ["DL"],
  middlesbrough: ["TS"],
  teesside: ["TS"],

  london: ["E", "EC", "N", "NW", "SE", "SW", "W", "WC"],
  "central london": ["EC", "WC", "W", "SW"],
  "greater london": [
    "E", "EC", "N", "NW", "SE", "SW", "W", "WC",
    "BR", "CR", "DA", "EN", "HA", "IG", "KT", "RM", "SM", "TW", "UB", "WD",
  ],
  croydon: ["CR"],
  bromley: ["BR"],
  enfield: ["EN"],
  harrow: ["HA"],
  ilford: ["IG"],
  kingston: ["KT"],
  romford: ["RM"],
  sutton: ["SM"],
  twickenham: ["TW"],
  uxbridge: ["UB"],
  watford: ["WD"],

  bristol: ["BS"],
  bath: ["BA"],
  oxford: ["OX"],
  cambridge: ["CB"],
  southampton: ["SO"],
  portsmouth: ["PO"],
  brighton: ["BN"],
  norwich: ["NR"],
  ipswich: ["IP"],
  plymouth: ["PL"],
  exeter: ["EX"],
  reading: ["RG"],
  slough: ["SL"],
  miltonkeynes: ["MK"],
  "milton keynes": ["MK"],
  northampton: ["NN"],
  peterborough: ["PE"],
  swindon: ["SN"],
  gloucester: ["GL"],
  bournemouth: ["BH"],
  carlisle: ["CA"],

  cardiff: ["CF"],
  swansea: ["SA"],
  newport: ["NP"],
  edinburgh: ["EH"],
  glasgow: ["G"],
  aberdeen: ["AB"],
  dundee: ["DD"],
  belfast: ["BT"],
};

/**
 * Human-friendly names for prominent postcode areas so tokens on screen say
 * "M (Manchester)" or "S (Sheffield)" rather than just an opaque letter.
 */
export const POSTCODE_AREA_NAMES: Record<string, string> = {
  S: "Sheffield",
  DN: "Doncaster",
  LS: "Leeds",
  BD: "Bradford",
  HD: "Huddersfield",
  HX: "Halifax",
  WF: "Wakefield",
  YO: "York",
  HG: "Harrogate",
  HU: "Hull",
  M: "Manchester",
  BL: "Bolton",
  OL: "Oldham",
  SK: "Stockport",
  WN: "Wigan",
  L: "Liverpool",
  CH: "Chester",
  WA: "Warrington",
  PR: "Preston",
  BB: "Blackburn",
  FY: "Blackpool",
  LA: "Lancaster",
  CA: "Carlisle",
  NE: "Newcastle",
  SR: "Sunderland",
  DH: "Durham",
  DL: "Darlington",
  TS: "Teesside",
  B: "Birmingham",
  CV: "Coventry",
  DY: "Dudley",
  WS: "Walsall",
  WV: "Wolverhampton",
  NG: "Nottingham",
  LE: "Leicester",
  DE: "Derby",
  ST: "Stoke-on-Trent",
  E: "East London",
  EC: "City of London",
  N: "North London",
  NW: "North West London",
  SE: "South East London",
  SW: "South West London",
  W: "West London",
  WC: "West Central London",
  BS: "Bristol",
  BA: "Bath",
  OX: "Oxford",
  CB: "Cambridge",
  SO: "Southampton",
  PO: "Portsmouth",
  BN: "Brighton",
  RG: "Reading",
  SL: "Slough",
  MK: "Milton Keynes",
  NN: "Northampton",
  PE: "Peterborough",
  NR: "Norwich",
  IP: "Ipswich",
  EX: "Exeter",
  PL: "Plymouth",
  CF: "Cardiff",
  SA: "Swansea",
  NP: "Newport",
  EH: "Edinburgh",
  G: "Glasgow",
  AB: "Aberdeen",
  DD: "Dundee",
  BT: "Northern Ireland",
};

/**
 * Resolves whatever user input was entered into a list of normalized postcode areas.
 *
 * Accepts:
 * - City or town name (e.g. "Manchester" → ["M"], "Greater Manchester" → ["M", "BL", "OL", "SK", "WN"])
 * - Raw postcode area (e.g. "M" → ["M"], "LS" → ["LS"])
 * - Full UK postcode (e.g. "M1 1AA" → ["M"], "S1 2HE" → ["S"])
 */
export function resolveLocationInput(input: string): string[] {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) return [];

  // 1. Direct match against presets
  const preset = CITY_REGION_PRESETS.find(
    (p) => p.name.toLowerCase() === trimmed || p.id === trimmed,
  );
  if (preset) return [...preset.postcodeAreas];

  // 2. Match against city aliases
  const aliasAreas = CITY_ALIASES[trimmed];
  if (aliasAreas) return [...aliasAreas];

  // 3. Fall back to standard postcode area normalisation
  const area = normalisePostcodeArea(input);
  if (area) return [area];

  return [];
}

/**
 * Returns a display label for a postcode area, e.g. "M (Manchester)" or "S (Sheffield)".
 */
export function formatPostcodeAreaLabel(area: string): string {
  const norm = area.toUpperCase().trim();
  const name = POSTCODE_AREA_NAMES[norm];
  return name ? `${norm} (${name})` : norm;
}
