/**
 * What the register offers to filter on.
 *
 * Counts are from the 2026-09-03 extract and are indicative — they seed the
 * filter controls so every option arrives with a sense of its size, before the
 * live count for the current filter set comes back. The authoritative numbers
 * always come from the database.
 *
 * This list is the regulator's vocabulary, not ours. It is not a whitelist and
 * nothing here decides what may be imported: it is the menu the screen offers,
 * and the whole menu is offered. That distinction is the point of this rewrite —
 * the previous design had a five-item list that was simultaneously the menu and
 * the policy, so there was no way to offer an option without also enabling it.
 */

export type VocabularyEntry = {
  /** The register's own wording — matched verbatim against the snapshot. */
  value: string;
  /** Shorter label for a chip, where the register's wording is unwieldy. */
  label: string;
  /** Roughly how many charities carry it, register-wide. */
  approxCount: number;
};

/** "What the charity does" — 17 values, all of them selectable. */
export const WHAT_CLASSIFICATIONS: readonly VocabularyEntry[] = [
  { value: "Education/training", label: "Education & training", approxCount: 83_841 },
  { value: "General Charitable Purposes", label: "General charitable purposes", approxCount: 59_032 },
  { value: "Religious Activities", label: "Religious activities", approxCount: 37_149 },
  { value: "The Prevention Or Relief Of Poverty", label: "Preventing or relieving poverty", approxCount: 34_225 },
  { value: "Arts/culture/heritage/science", label: "Arts, culture, heritage & science", approxCount: 29_979 },
  { value: "The Advancement Of Health Or Saving Of Lives", label: "Health & saving lives", approxCount: 28_004 },
  { value: "Disability", label: "Disability", approxCount: 27_308 },
  { value: "Amateur Sport", label: "Amateur sport", approxCount: 25_869 },
  { value: "Economic/community Development/employment", label: "Community development & employment", approxCount: 21_112 },
  { value: "Environment/conservation/heritage", label: "Environment & conservation", approxCount: 18_695 },
  { value: "Recreation", label: "Recreation", approxCount: 17_819 },
  { value: "Other Charitable Purposes", label: "Other charitable purposes", approxCount: 15_039 },
  { value: "Overseas Aid/famine Relief", label: "Overseas aid & famine relief", approxCount: 9_277 },
  { value: "Accommodation/housing", label: "Accommodation & housing", approxCount: 7_676 },
  { value: "Human Rights/religious Or Racial Harmony/equality Or Diversity", label: "Human rights & equality", approxCount: 7_146 },
  { value: "Animals", label: "Animals", approxCount: 4_619 },
  { value: "Armed Forces/emergency Service Efficiency", label: "Armed forces & emergency services", approxCount: 997 },
];

/** "Who the charity helps" — 7 values. Never previously filterable at all. */
export const WHO_CLASSIFICATIONS: readonly VocabularyEntry[] = [
  { value: "Children/young People", label: "Children & young people", approxCount: 95_725 },
  { value: "The General Public/mankind", label: "The general public", approxCount: 92_522 },
  { value: "Elderly/old People", label: "Elderly people", approxCount: 51_774 },
  { value: "People With Disabilities", label: "People with disabilities", approxCount: 46_115 },
  { value: "Other Charities Or Voluntary Bodies", label: "Other charities & voluntary bodies", approxCount: 40_976 },
  { value: "Other Defined Groups", label: "Other defined groups", approxCount: 26_597 },
  { value: "People Of A Particular Ethnic Or Racial Origin", label: "A particular ethnic or racial origin", approxCount: 15_758 },
];

/** "How the charity works" — 10 values. Also never previously filterable. */
export const HOW_CLASSIFICATIONS: readonly VocabularyEntry[] = [
  { value: "Provides Services", label: "Provides services", approxCount: 73_140 },
  { value: "Provides Buildings/facilities/open Space", label: "Provides buildings & facilities", approxCount: 54_837 },
  { value: "Makes Grants To Organisations", label: "Makes grants to organisations", approxCount: 49_114 },
  { value: "Provides Advocacy/advice/information", label: "Advocacy, advice & information", approxCount: 48_394 },
  { value: "Makes Grants To Individuals", label: "Makes grants to individuals", approxCount: 34_604 },
  { value: "Other Charitable Activities", label: "Other charitable activities", approxCount: 26_970 },
  { value: "Provides Human Resources", label: "Provides human resources", approxCount: 25_436 },
  { value: "Acts As An Umbrella Or Resource Body", label: "Umbrella or resource body", approxCount: 14_288 },
  { value: "Sponsors Or Undertakes Research", label: "Sponsors or undertakes research", approxCount: 13_120 },
  { value: "Provides Other Finance", label: "Provides other finance", approxCount: 12_237 },
];

/**
 * The four region entries the Charity Commission register actually publishes.
 * The regulator does not classify by standard UK statistical regions (e.g.
 * Yorkshire and the Humber) — those are filtered via Local Authorities or Postcode
 * areas. Countries (275 of them) and the full 174 local authorities are loaded
 * from the snapshot instead of hardcoded.
 */
export const REGIONS: readonly string[] = [
  "Throughout England",
  "Throughout England And Wales",
  "Throughout London",
  "Throughout Wales",
];

/**
 * Local authorities to offer first, because they are where the branch works
 * today. Note the register's own spelling: **"Sheffield City"**, not
 * "Sheffield". The previous implementation compared against "sheffield" and so
 * never matched, hiding 127 charities that operate in Sheffield but are
 * registered to an address outside the S postcode area.
 *
 * A suggestion, not a restriction — every one of the register's 174 local
 * authorities is selectable from the same control.
 */
export const SUGGESTED_LOCAL_AUTHORITIES: readonly string[] = [
  "Sheffield City",
  "Rotherham",
  "Barnsley",
  "Doncaster",
];

export type RegionalZone = "All" | "Yorkshire" | "North" | "Midlands & East" | "London & South" | "Wales";

export type RegionalGroup = {
  id: string;
  name: string;
  zone: Exclude<RegionalZone, "All">;
  authorities: readonly string[];
  isSubregion?: boolean;
};

/**
 * All 174 local authorities published by the Charity Commission.
 * Guaranteed that every authority here belongs to at least one group in UK_REGIONAL_GROUPS.
 */
export const ALL_LOCAL_AUTHORITIES: readonly string[] = [
  "Barking And Dagenham",
  "Barnet",
  "Barnsley",
  "Bath And North East Somerset",
  "Bedford",
  "Bexley",
  "Birmingham City",
  "Blackburn With Darwen",
  "Blackpool",
  "Blaenau Gwent",
  "Bolton",
  "Bournemouth",
  "Bracknell Forest",
  "Bradford City",
  "Brent",
  "Bridgend",
  "Brighton And Hove",
  "Bristol City",
  "Bromley",
  "Buckinghamshire",
  "Bury",
  "Caerphilly",
  "Calderdale",
  "Cambridgeshire",
  "Camden",
  "Cardiff",
  "Carmarthenshire",
  "Central Bedfordshire",
  "Ceredigion",
  "Cheshire East",
  "Cheshire West & Chester",
  "City Of London",
  "City Of Swansea",
  "City Of Wakefield",
  "City Of Westminster",
  "City Of York",
  "Conwy",
  "Cornwall",
  "Coventry City",
  "Croydon",
  "Cumbria",
  "Darlington",
  "Denbighshire",
  "Derby City",
  "Derbyshire",
  "Devon",
  "Doncaster",
  "Dorset",
  "Dudley",
  "Durham",
  "Ealing",
  "East Riding Of Yorkshire",
  "East Sussex",
  "Enfield",
  "Essex",
  "Flintshire",
  "Gateshead",
  "Gloucestershire",
  "Greenwich",
  "Gwynedd",
  "Hackney",
  "Halton",
  "Hammersmith And Fulham",
  "Hampshire",
  "Haringey",
  "Harrow",
  "Hartlepool",
  "Havering",
  "Herefordshire",
  "Hertfordshire",
  "Hillingdon",
  "Hounslow",
  "Isle Of Anglesey",
  "Isle Of Wight",
  "Isles Of Scilly",
  "Islington",
  "Kensington And Chelsea",
  "Kent",
  "Kingston Upon Hull City",
  "Kingston Upon Thames",
  "Kirklees",
  "Knowsley",
  "Lambeth",
  "Lancashire",
  "Leeds City",
  "Leicester City",
  "Leicestershire",
  "Lewisham",
  "Lincolnshire",
  "Liverpool City",
  "Luton",
  "Manchester City",
  "Medway",
  "Merthyr Tydfil",
  "Merton",
  "Middlesbrough",
  "Milton Keynes",
  "Monmouthshire",
  "Neath Port Talbot",
  "Newcastle Upon Tyne City",
  "Newham",
  "Newport City",
  "Norfolk",
  "North East Lincolnshire",
  "North Lincolnshire",
  "North Somerset",
  "North Tyneside",
  "North Yorkshire",
  "Northamptonshire",
  "Northumberland",
  "Nottingham City",
  "Nottinghamshire",
  "Oldham",
  "Oxfordshire",
  "Pembrokeshire",
  "Peterborough City",
  "Plymouth City",
  "Poole",
  "Portsmouth City",
  "Powys",
  "Reading",
  "Redbridge",
  "Redcar And Cleveland",
  "Rhondda Cynon Taff",
  "Richmond Upon Thames",
  "Rochdale",
  "Rotherham",
  "Rutland",
  "Salford City",
  "Sandwell",
  "Sefton",
  "Sheffield City",
  "Shropshire",
  "Slough",
  "Solihull",
  "Somerset",
  "South Gloucestershire",
  "South Tyneside",
  "Southampton City",
  "Southend-on-sea",
  "Southwark",
  "St Helens",
  "Staffordshire",
  "Stockport",
  "Stockton-on-tees",
  "Stoke-on-trent City",
  "Suffolk",
  "Sunderland",
  "Surrey",
  "Sutton",
  "Swindon",
  "Tameside",
  "Telford & Wrekin",
  "Thurrock",
  "Torbay",
  "Torfaen",
  "Tower Hamlets",
  "Trafford",
  "Vale Of Glamorgan",
  "Walsall",
  "Waltham Forest",
  "Wandsworth",
  "Warrington",
  "Warwickshire",
  "West Berkshire",
  "West Sussex",
  "Wigan",
  "Wiltshire",
  "Windsor And Maidenhead",
  "Wirral",
  "Wokingham",
  "Wolverhampton",
  "Worcestershire",
  "Wrexham",
];

/**
 * Regional groups that batch-select local authorities.
 * Every single one of the 174 local authorities belongs to at least one group.
 */
export const UK_REGIONAL_GROUPS: readonly RegionalGroup[] = [
  // ── Yorkshire (180DC Sheffield's local region & sub-regions) ───────
  {
    id: "south-yorkshire",
    name: "South Yorkshire",
    zone: "Yorkshire",
    authorities: ["Barnsley", "Doncaster", "Rotherham", "Sheffield City"],
    isSubregion: true,
  },
  {
    id: "west-yorkshire",
    name: "West Yorkshire",
    zone: "Yorkshire",
    authorities: ["Bradford City", "Calderdale", "City Of Wakefield", "Kirklees", "Leeds City"],
    isSubregion: true,
  },
  {
    id: "north-yorkshire",
    name: "North Yorkshire & York",
    zone: "Yorkshire",
    authorities: ["City Of York", "North Yorkshire"],
    isSubregion: true,
  },
  {
    id: "east-riding-humber",
    name: "East Riding & Humber",
    zone: "Yorkshire",
    authorities: ["East Riding Of Yorkshire", "Kingston Upon Hull City", "North East Lincolnshire", "North Lincolnshire"],
    isSubregion: true,
  },
  {
    id: "all-yorkshire",
    name: "All Yorkshire & Humber",
    zone: "Yorkshire",
    authorities: [
      "Barnsley", "Doncaster", "Rotherham", "Sheffield City",
      "Bradford City", "Calderdale", "City Of Wakefield", "Kirklees", "Leeds City",
      "City Of York", "North Yorkshire",
      "East Riding Of Yorkshire", "Kingston Upon Hull City", "North East Lincolnshire", "North Lincolnshire",
    ],
  },

  // ── North West & North East ────────────────────────────────────────
  {
    id: "greater-manchester",
    name: "Greater Manchester",
    zone: "North",
    authorities: ["Bolton", "Bury", "Manchester City", "Oldham", "Rochdale", "Salford City", "Stockport", "Tameside", "Trafford", "Wigan"],
    isSubregion: true,
  },
  {
    id: "merseyside",
    name: "Merseyside",
    zone: "North",
    authorities: ["Knowsley", "Liverpool City", "Sefton", "St Helens", "Wirral"],
    isSubregion: true,
  },
  {
    id: "lancashire",
    name: "Lancashire",
    zone: "North",
    authorities: ["Blackburn With Darwen", "Blackpool", "Lancashire"],
    isSubregion: true,
  },
  {
    id: "cheshire",
    name: "Cheshire",
    zone: "North",
    authorities: ["Cheshire East", "Cheshire West & Chester", "Halton", "Warrington"],
    isSubregion: true,
  },
  {
    id: "cumbria",
    name: "Cumbria",
    zone: "North",
    authorities: ["Cumbria"],
    isSubregion: true,
  },
  {
    id: "north-west-all",
    name: "North West (All)",
    zone: "North",
    authorities: [
      "Blackburn With Darwen", "Blackpool", "Bolton", "Bury", "Cheshire East", "Cheshire West & Chester",
      "Cumbria", "Halton", "Knowsley", "Lancashire", "Liverpool City", "Manchester City", "Oldham",
      "Rochdale", "Salford City", "Sefton", "St Helens", "Stockport", "Tameside", "Trafford",
      "Warrington", "Wigan", "Wirral",
    ],
  },
  {
    id: "north-east",
    name: "North East",
    zone: "North",
    authorities: [
      "Darlington", "Durham", "Gateshead", "Hartlepool", "Middlesbrough", "Newcastle Upon Tyne City",
      "North Tyneside", "Northumberland", "Redcar And Cleveland", "South Tyneside", "Stockton-on-tees", "Sunderland",
    ],
  },

  // ── Midlands & East ────────────────────────────────────────────────
  {
    id: "west-midlands",
    name: "West Midlands",
    zone: "Midlands & East",
    authorities: [
      "Birmingham City", "Coventry City", "Dudley", "Herefordshire", "Sandwell", "Shropshire", "Solihull",
      "Staffordshire", "Stoke-on-trent City", "Telford & Wrekin", "Walsall", "Warwickshire", "Wolverhampton", "Worcestershire",
    ],
  },
  {
    id: "east-midlands",
    name: "East Midlands",
    zone: "Midlands & East",
    authorities: [
      "Derby City", "Derbyshire", "Leicester City", "Leicestershire", "Lincolnshire", "Northamptonshire",
      "Nottingham City", "Nottinghamshire", "Rutland",
    ],
  },
  {
    id: "east-of-england",
    name: "East of England",
    zone: "Midlands & East",
    authorities: [
      "Bedford", "Cambridgeshire", "Central Bedfordshire", "Essex", "Hertfordshire", "Luton", "Norfolk",
      "Peterborough City", "Southend-on-sea", "Suffolk", "Thurrock",
    ],
  },

  // ── London & South ─────────────────────────────────────────────────
  {
    id: "london",
    name: "London",
    zone: "London & South",
    authorities: [
      "Barking And Dagenham", "Barnet", "Bexley", "Brent", "Bromley", "Camden", "City Of London",
      "City Of Westminster", "Croydon", "Ealing", "Enfield", "Greenwich", "Hackney", "Hammersmith And Fulham",
      "Haringey", "Harrow", "Havering", "Hillingdon", "Hounslow", "Islington", "Kensington And Chelsea",
      "Kingston Upon Thames", "Lambeth", "Lewisham", "Merton", "Newham", "Redbridge", "Richmond Upon Thames",
      "Southwark", "Sutton", "Tower Hamlets", "Waltham Forest", "Wandsworth",
    ],
  },
  {
    id: "south-east",
    name: "South East",
    zone: "London & South",
    authorities: [
      "Bracknell Forest", "Brighton And Hove", "Buckinghamshire", "East Sussex", "Hampshire", "Isle Of Wight",
      "Kent", "Medway", "Milton Keynes", "Oxfordshire", "Portsmouth City", "Reading", "Slough",
      "Southampton City", "Surrey", "West Berkshire", "West Sussex", "Windsor And Maidenhead", "Wokingham",
    ],
  },
  {
    id: "south-west",
    name: "South West",
    zone: "London & South",
    authorities: [
      "Bath And North East Somerset", "Bournemouth", "Bristol City", "Cornwall", "Devon", "Dorset",
      "Gloucestershire", "Isles Of Scilly", "North Somerset", "Plymouth City", "Poole", "Somerset",
      "South Gloucestershire", "Swindon", "Torbay", "Wiltshire",
    ],
  },

  // ── Wales ──────────────────────────────────────────────────────────
  {
    id: "wales",
    name: "Wales",
    zone: "Wales",
    authorities: [
      "Blaenau Gwent", "Bridgend", "Caerphilly", "Cardiff", "Carmarthenshire", "Ceredigion", "City Of Swansea",
      "Conwy", "Denbighshire", "Flintshire", "Gwynedd", "Isle Of Anglesey", "Merthyr Tydfil", "Monmouthshire",
      "Neath Port Talbot", "Newport City", "Pembrokeshire", "Powys", "Rhondda Cynon Taff", "Torfaen",
      "Vale Of Glamorgan", "Wrexham",
    ],
  },
];

/** Postcode areas offered as quick picks. Any area can be typed. */
export const SUGGESTED_POSTCODE_AREAS: readonly string[] = ["S", "DN"];

/**
 * Income steps for the range control, chosen to match how charity size is
 * actually talked about rather than as even intervals. `null` is "no limit".
 */
export const INCOME_STEPS: readonly (number | null)[] = [
  0, 10_000, 25_000, 50_000, 100_000, 250_000, 500_000, 1_000_000, 5_000_000, null,
];

