/**
 * Curated dataset of UK cities and prominent towns with regions/nations.
 *
 * Used for the inline "Town or city" autocomplete on client records and filters,
 * ensuring fast lookup, consistent Title Case naming, and regional context.
 */

import { normalizeCity } from "./city.ts";

export type UkCityType = "city" | "town" | "borough" | "region";

export type UkCityItem = {
  name: string;
  region: string;
  type: UkCityType;
};

export const UK_CITIES: readonly UkCityItem[] = [
  // --- South Yorkshire & Yorkshire ---
  { name: "Sheffield", region: "South Yorkshire", type: "city" },
  { name: "Leeds", region: "West Yorkshire", type: "city" },
  { name: "Bradford", region: "West Yorkshire", type: "city" },
  { name: "York", region: "North Yorkshire", type: "city" },
  { name: "Hull", region: "East Yorkshire", type: "city" },
  { name: "Kingston upon Hull", region: "East Yorkshire", type: "city" },
  { name: "Rotherham", region: "South Yorkshire", type: "town" },
  { name: "Barnsley", region: "South Yorkshire", type: "town" },
  { name: "Doncaster", region: "South Yorkshire", type: "city" },
  { name: "Wakefield", region: "West Yorkshire", type: "city" },
  { name: "Huddersfield", region: "West Yorkshire", type: "town" },
  { name: "Halifax", region: "West Yorkshire", type: "town" },
  { name: "Harrogate", region: "North Yorkshire", type: "town" },
  { name: "Scarborough", region: "North Yorkshire", type: "town" },
  { name: "Keighley", region: "West Yorkshire", type: "town" },
  { name: "Dewsbury", region: "West Yorkshire", type: "town" },
  { name: "Batley", region: "West Yorkshire", type: "town" },
  { name: "Pontefract", region: "West Yorkshire", type: "town" },
  { name: "Castleford", region: "West Yorkshire", type: "town" },
  { name: "Ripon", region: "North Yorkshire", type: "city" },
  { name: "Knaresborough", region: "North Yorkshire", type: "town" },
  { name: "Whitby", region: "North Yorkshire", type: "town" },
  { name: "Selby", region: "North Yorkshire", type: "town" },
  { name: "Beverley", region: "East Yorkshire", type: "town" },
  { name: "Bridlington", region: "East Yorkshire", type: "town" },

  // --- Greater London ---
  { name: "London", region: "Greater London", type: "city" },
  { name: "Westminster", region: "Greater London", type: "city" },
  { name: "Croydon", region: "Greater London", type: "borough" },
  { name: "Bromley", region: "Greater London", type: "borough" },
  { name: "Enfield", region: "Greater London", type: "borough" },
  { name: "Harrow", region: "Greater London", type: "borough" },
  { name: "Kingston upon Thames", region: "Greater London", type: "borough" },
  { name: "Richmond upon Thames", region: "Greater London", type: "borough" },
  { name: "Greenwich", region: "Greater London", type: "borough" },
  { name: "Barnet", region: "Greater London", type: "borough" },
  { name: "Ealing", region: "Greater London", type: "borough" },
  { name: "Hounslow", region: "Greater London", type: "borough" },
  { name: "Wembley", region: "Greater London", type: "town" },
  { name: "Stratford", region: "Greater London", type: "town" },
  { name: "Romford", region: "Greater London", type: "town" },
  { name: "Ilford", region: "Greater London", type: "town" },
  { name: "Uxbridge", region: "Greater London", type: "town" },
  { name: "Sutton", region: "Greater London", type: "town" },

  // --- North West ---
  { name: "Manchester", region: "Greater Manchester", type: "city" },
  { name: "Liverpool", region: "Merseyside", type: "city" },
  { name: "Salford", region: "Greater Manchester", type: "city" },
  { name: "Preston", region: "Lancashire", type: "city" },
  { name: "Lancaster", region: "Lancashire", type: "city" },
  { name: "Chester", region: "Cheshire", type: "city" },
  { name: "Carlisle", region: "Cumbria", type: "city" },
  { name: "Bolton", region: "Greater Manchester", type: "town" },
  { name: "Stockport", region: "Greater Manchester", type: "town" },
  { name: "Oldham", region: "Greater Manchester", type: "town" },
  { name: "Rochdale", region: "Greater Manchester", type: "town" },
  { name: "Bury", region: "Greater Manchester", type: "town" },
  { name: "Wigan", region: "Greater Manchester", type: "town" },
  { name: "Warrington", region: "Cheshire", type: "town" },
  { name: "Blackpool", region: "Lancashire", type: "town" },
  { name: "Blackburn", region: "Lancashire", type: "town" },
  { name: "Burnley", region: "Lancashire", type: "town" },
  { name: "Southport", region: "Merseyside", type: "town" },
  { name: "Birkenhead", region: "Merseyside", type: "town" },
  { name: "St Helens", region: "Merseyside", type: "town" },
  { name: "Crewe", region: "Cheshire", type: "town" },
  { name: "Macclesfield", region: "Cheshire", type: "town" },
  { name: "Widnes", region: "Cheshire", type: "town" },
  { name: "Runcorn", region: "Cheshire", type: "town" },
  { name: "Ellesmere Port", region: "Cheshire", type: "town" },
  { name: "Kendal", region: "Cumbria", type: "town" },
  { name: "Barrow-in-Furness", region: "Cumbria", type: "town" },
  { name: "Workington", region: "Cumbria", type: "town" },
  { name: "Whitehaven", region: "Cumbria", type: "town" },
  { name: "Penrith", region: "Cumbria", type: "town" },

  // --- West Midlands ---
  { name: "Birmingham", region: "West Midlands", type: "city" },
  { name: "Coventry", region: "West Midlands", type: "city" },
  { name: "Wolverhampton", region: "West Midlands", type: "city" },
  { name: "Stoke-on-Trent", region: "Staffordshire", type: "city" },
  { name: "Worcester", region: "Worcestershire", type: "city" },
  { name: "Hereford", region: "Herefordshire", type: "city" },
  { name: "Lichfield", region: "Staffordshire", type: "city" },
  { name: "Solihull", region: "West Midlands", type: "town" },
  { name: "Dudley", region: "West Midlands", type: "town" },
  { name: "Walsall", region: "West Midlands", type: "town" },
  { name: "West Bromwich", region: "West Midlands", type: "town" },
  { name: "Sutton Coldfield", region: "West Midlands", type: "town" },
  { name: "Telford", region: "Shropshire", type: "town" },
  { name: "Shrewsbury", region: "Shropshire", type: "town" },
  { name: "Stafford", region: "Staffordshire", type: "town" },
  { name: "Tamworth", region: "Staffordshire", type: "town" },
  { name: "Burton upon Trent", region: "Staffordshire", type: "town" },
  { name: "Newcastle-under-Lyme", region: "Staffordshire", type: "town" },
  { name: "Nuneaton", region: "Warwickshire", type: "town" },
  { name: "Rugby", region: "Warwickshire", type: "town" },
  { name: "Royal Leamington Spa", region: "Warwickshire", type: "town" },
  { name: "Warwick", region: "Warwickshire", type: "town" },
  { name: "Stratford-upon-Avon", region: "Warwickshire", type: "town" },
  { name: "Redditch", region: "Worcestershire", type: "town" },
  { name: "Kidderminster", region: "Worcestershire", type: "town" },

  // --- East Midlands ---
  { name: "Nottingham", region: "Nottinghamshire", type: "city" },
  { name: "Leicester", region: "Leicestershire", type: "city" },
  { name: "Derby", region: "Derbyshire", type: "city" },
  { name: "Lincoln", region: "Lincolnshire", type: "city" },
  { name: "Northampton", region: "Northamptonshire", type: "town" },
  { name: "Chesterfield", region: "Derbyshire", type: "town" },
  { name: "Mansfield", region: "Nottinghamshire", type: "town" },
  { name: "Loughborough", region: "Leicestershire", type: "town" },
  { name: "Corby", region: "Northamptonshire", type: "town" },
  { name: "Kettering", region: "Northamptonshire", type: "town" },
  { name: "Wellingborough", region: "Northamptonshire", type: "town" },
  { name: "Grantham", region: "Lincolnshire", type: "town" },
  { name: "Boston", region: "Lincolnshire", type: "town" },
  { name: "Grimsby", region: "Lincolnshire", type: "town" },
  { name: "Scunthorpe", region: "Lincolnshire", type: "town" },
  { name: "Newark-on-Trent", region: "Nottinghamshire", type: "town" },
  { name: "Worksop", region: "Nottinghamshire", type: "town" },
  { name: "Buxton", region: "Derbyshire", type: "town" },

  // --- North East ---
  { name: "Newcastle upon Tyne", region: "Tyne and Wear", type: "city" },
  { name: "Sunderland", region: "Tyne and Wear", type: "city" },
  { name: "Durham", region: "County Durham", type: "city" },
  { name: "Middlesbrough", region: "North Yorkshire", type: "town" },
  { name: "Gateshead", region: "Tyne and Wear", type: "town" },
  { name: "South Shields", region: "Tyne and Wear", type: "town" },
  { name: "Darlington", region: "County Durham", type: "town" },
  { name: "Hartlepool", region: "County Durham", type: "town" },
  { name: "Stockton-on-Tees", region: "County Durham", type: "town" },
  { name: "Tynemouth", region: "Tyne and Wear", type: "town" },
  { name: "Blyth", region: "Northumberland", type: "town" },
  { name: "Ashington", region: "Northumberland", type: "town" },
  { name: "Cramlington", region: "Northumberland", type: "town" },
  { name: "Hexham", region: "Northumberland", type: "town" },
  { name: "Berwick-upon-Tweed", region: "Northumberland", type: "town" },

  // --- East of England ---
  { name: "Norwich", region: "Norfolk", type: "city" },
  { name: "Cambridge", region: "Cambridgeshire", type: "city" },
  { name: "Peterborough", region: "Cambridgeshire", type: "city" },
  { name: "St Albans", region: "Hertfordshire", type: "city" },
  { name: "Chelmsford", region: "Essex", type: "city" },
  { name: "Colchester", region: "Essex", type: "city" },
  { name: "Southend-on-Sea", region: "Essex", type: "city" },
  { name: "Ely", region: "Cambridgeshire", type: "city" },
  { name: "Luton", region: "Bedfordshire", type: "town" },
  { name: "Milton Keynes", region: "Buckinghamshire", type: "city" },
  { name: "Ipswich", region: "Suffolk", type: "town" },
  { name: "Watford", region: "Hertfordshire", type: "town" },
  { name: "Bedford", region: "Bedfordshire", type: "town" },
  { name: "Stevenage", region: "Hertfordshire", type: "town" },
  { name: "Hemel Hempstead", region: "Hertfordshire", type: "town" },
  { name: "Welwyn Garden City", region: "Hertfordshire", type: "town" },
  { name: "Harlow", region: "Essex", type: "town" },
  { name: "Basildon", region: "Essex", type: "town" },
  { name: "Brentwood", region: "Essex", type: "town" },
  { name: "Bury St Edmunds", region: "Suffolk", type: "town" },
  { name: "Lowestoft", region: "Suffolk", type: "town" },
  { name: "Great Yarmouth", region: "Norfolk", type: "town" },
  { name: "King's Lynn", region: "Norfolk", type: "town" },

  // --- South East ---
  { name: "Southampton", region: "Hampshire", type: "city" },
  { name: "Portsmouth", region: "Hampshire", type: "city" },
  { name: "Brighton and Hove", region: "East Sussex", type: "city" },
  { name: "Brighton", region: "East Sussex", type: "city" },
  { name: "Oxford", region: "Oxfordshire", type: "city" },
  { name: "Canterbury", region: "Kent", type: "city" },
  { name: "Winchester", region: "Hampshire", type: "city" },
  { name: "Chichester", region: "West Sussex", type: "city" },
  { name: "Reading", region: "Berkshire", type: "town" },
  { name: "Slough", region: "Berkshire", type: "town" },
  { name: "Bracknell", region: "Berkshire", type: "town" },
  { name: "Maidenhead", region: "Berkshire", type: "town" },
  { name: "Windsor", region: "Berkshire", type: "town" },
  { name: "Newbury", region: "Berkshire", type: "town" },
  { name: "High Wycombe", region: "Buckinghamshire", type: "town" },
  { name: "Aylesbury", region: "Buckinghamshire", type: "town" },
  { name: "Banbury", region: "Oxfordshire", type: "town" },
  { name: "Bicester", region: "Oxfordshire", type: "town" },
  { name: "Abingdon", region: "Oxfordshire", type: "town" },
  { name: "Basingstoke", region: "Hampshire", type: "town" },
  { name: "Andover", region: "Hampshire", type: "town" },
  { name: "Farnborough", region: "Hampshire", type: "town" },
  { name: "Aldershot", region: "Hampshire", type: "town" },
  { name: "Guildford", region: "Surrey", type: "town" },
  { name: "Woking", region: "Surrey", type: "town" },
  { name: "Epsom", region: "Surrey", type: "town" },
  { name: "Crawley", region: "West Sussex", type: "town" },
  { name: "Worthing", region: "West Sussex", type: "town" },
  { name: "Horsham", region: "West Sussex", type: "town" },
  { name: "Eastbourne", region: "East Sussex", type: "town" },
  { name: "Hastings", region: "East Sussex", type: "town" },
  { name: "Maidstone", region: "Kent", type: "town" },
  { name: "Gillingham", region: "Kent", type: "town" },
  { name: "Chatham", region: "Kent", type: "town" },
  { name: "Dartford", region: "Kent", type: "town" },
  { name: "Gravesend", region: "Kent", type: "town" },
  { name: "Ashford", region: "Kent", type: "town" },
  { name: "Royal Tunbridge Wells", region: "Kent", type: "town" },
  { name: "Folkestone", region: "Kent", type: "town" },
  { name: "Dover", region: "Kent", type: "town" },
  { name: "Margate", region: "Kent", type: "town" },

  // --- South West ---
  { name: "Bristol", region: "Bristol", type: "city" },
  { name: "Plymouth", region: "Devon", type: "city" },
  { name: "Exeter", region: "Devon", type: "city" },
  { name: "Bath", region: "Somerset", type: "city" },
  { name: "Gloucester", region: "Gloucestershire", type: "city" },
  { name: "Salisbury", region: "Wiltshire", type: "city" },
  { name: "Wells", region: "Somerset", type: "city" },
  { name: "Truro", region: "Cornwall", type: "city" },
  { name: "Bournemouth", region: "Dorset", type: "town" },
  { name: "Poole", region: "Dorset", type: "town" },
  { name: "Swindon", region: "Wiltshire", type: "town" },
  { name: "Cheltenham", region: "Gloucestershire", type: "town" },
  { name: "Torquay", region: "Devon", type: "town" },
  { name: "Paignton", region: "Devon", type: "town" },
  { name: "Weston-super-Mare", region: "Somerset", type: "town" },
  { name: "Taunton", region: "Somerset", type: "town" },
  { name: "Yeovil", region: "Somerset", type: "town" },
  { name: "Weymouth", region: "Dorset", type: "town" },
  { name: "Dorchester", region: "Dorset", type: "town" },
  { name: "Chippenham", region: "Wiltshire", type: "town" },
  { name: "Trowbridge", region: "Wiltshire", type: "town" },
  { name: "Stroud", region: "Gloucestershire", type: "town" },
  { name: "Cirencester", region: "Gloucestershire", type: "town" },
  { name: "Falmouth", region: "Cornwall", type: "town" },
  { name: "Penzance", region: "Cornwall", type: "town" },
  { name: "Newquay", region: "Cornwall", type: "town" },
  { name: "St Austell", region: "Cornwall", type: "town" },

  // --- Scotland ---
  { name: "Glasgow", region: "Scotland", type: "city" },
  { name: "Edinburgh", region: "Scotland", type: "city" },
  { name: "Aberdeen", region: "Scotland", type: "city" },
  { name: "Dundee", region: "Scotland", type: "city" },
  { name: "Inverness", region: "Scotland", type: "city" },
  { name: "Stirling", region: "Scotland", type: "city" },
  { name: "Perth", region: "Scotland", type: "city" },
  { name: "Dunfermline", region: "Scotland", type: "city" },
  { name: "Paisley", region: "Scotland", type: "town" },
  { name: "East Kilbride", region: "Scotland", type: "town" },
  { name: "Livingston", region: "Scotland", type: "town" },
  { name: "Hamilton", region: "Scotland", type: "town" },
  { name: "Cumbernauld", region: "Scotland", type: "town" },
  { name: "Kirkcaldy", region: "Scotland", type: "town" },
  { name: "Ayr", region: "Scotland", type: "town" },
  { name: "Kilmarnock", region: "Scotland", type: "town" },
  { name: "Greenock", region: "Scotland", type: "town" },
  { name: "Coatbridge", region: "Scotland", type: "town" },
  { name: "Glenrothes", region: "Scotland", type: "town" },
  { name: "Airdrie", region: "Scotland", type: "town" },
  { name: "Falkirk", region: "Scotland", type: "town" },
  { name: "Irvine", region: "Scotland", type: "town" },
  { name: "Dumfries", region: "Scotland", type: "town" },
  { name: "Motherwell", region: "Scotland", type: "town" },
  { name: "St Andrews", region: "Scotland", type: "town" },
  { name: "Fort William", region: "Scotland", type: "town" },
  { name: "Oban", region: "Scotland", type: "town" },
  { name: "Elgin", region: "Scotland", type: "town" },

  // --- Wales ---
  { name: "Cardiff", region: "Wales", type: "city" },
  { name: "Swansea", region: "Wales", type: "city" },
  { name: "Newport", region: "Wales", type: "city" },
  { name: "Wrexham", region: "Wales", type: "city" },
  { name: "Bangor", region: "Wales", type: "city" },
  { name: "St Davids", region: "Wales", type: "city" },
  { name: "St Asaph", region: "Wales", type: "city" },
  { name: "Barry", region: "Wales", type: "town" },
  { name: "Bridgend", region: "Wales", type: "town" },
  { name: "Cwmbran", region: "Wales", type: "town" },
  { name: "Llanelli", region: "Wales", type: "town" },
  { name: "Neath", region: "Wales", type: "town" },
  { name: "Port Talbot", region: "Wales", type: "town" },
  { name: "Merthyr Tydfil", region: "Wales", type: "town" },
  { name: "Pontypridd", region: "Wales", type: "town" },
  { name: "Caerphilly", region: "Wales", type: "town" },
  { name: "Rhyl", region: "Wales", type: "town" },
  { name: "Colwyn Bay", region: "Wales", type: "town" },
  { name: "Llandudno", region: "Wales", type: "town" },
  { name: "Aberystwyth", region: "Wales", type: "town" },
  { name: "Carmarthen", region: "Wales", type: "town" },
  { name: "Haverfordwest", region: "Wales", type: "town" },

  // --- Northern Ireland ---
  { name: "Belfast", region: "Northern Ireland", type: "city" },
  { name: "Derry", region: "Northern Ireland", type: "city" },
  { name: "Londonderry", region: "Northern Ireland", type: "city" },
  { name: "Lisburn", region: "Northern Ireland", type: "city" },
  { name: "Newry", region: "Northern Ireland", type: "city" },
  { name: "Armagh", region: "Northern Ireland", type: "city" },
  { name: "Bangor (NI)", region: "Northern Ireland", type: "city" },
  { name: "Craigavon", region: "Northern Ireland", type: "town" },
  { name: "Ballymena", region: "Northern Ireland", type: "town" },
  { name: "Newtownards", region: "Northern Ireland", type: "town" },
  { name: "Carrickfergus", region: "Northern Ireland", type: "town" },
  { name: "Coleraine", region: "Northern Ireland", type: "town" },
  { name: "Antrim", region: "Northern Ireland", type: "town" },
  { name: "Omagh", region: "Northern Ireland", type: "town" },
  { name: "Larne", region: "Northern Ireland", type: "town" },
  { name: "Banbridge", region: "Northern Ireland", type: "town" },
  { name: "Enniskillen", region: "Northern Ireland", type: "town" },
  { name: "Strabane", region: "Northern Ireland", type: "town" },
] as const;

/**
 * Top suggested cities shown when user has not typed anything or focuses the input.
 */
export const POPULAR_UK_CITIES = [
  "Sheffield",
  "London",
  "Manchester",
  "Leeds",
  "Birmingham",
  "Edinburgh",
  "Glasgow",
  "Bristol",
  "Liverpool",
  "Cardiff",
  "Belfast",
  "Newcastle upon Tyne",
  "Nottingham",
  "Rotherham",
  "Barnsley",
  "Doncaster",
] as const;

/**
 * Search and filter UK cities with prefix matching prioritized over substring matching.
 */
export function searchUkCities(
  query: string | null | undefined,
  limit = 8,
): UkCityItem[] {
  const trimmed = query?.trim() ?? "";
  if (!trimmed) {
    // Return popular UK cities by default
    const result: UkCityItem[] = [];
    for (const name of POPULAR_UK_CITIES) {
      const match = UK_CITIES.find((c) => c.name.toLowerCase() === name.toLowerCase());
      if (match) result.push(match);
    }
    return result.slice(0, limit);
  }

  const needle = trimmed.toLowerCase();

  const exactMatches: UkCityItem[] = [];
  const prefixMatches: UkCityItem[] = [];
  const substringMatches: UkCityItem[] = [];
  const seen = new Set<string>();

  for (const item of UK_CITIES) {
    const itemNameLower = item.name.toLowerCase();
    if (seen.has(itemNameLower)) continue;

    if (itemNameLower === needle) {
      exactMatches.push(item);
      seen.add(itemNameLower);
    } else if (itemNameLower.startsWith(needle)) {
      prefixMatches.push(item);
      seen.add(itemNameLower);
    } else if (
      itemNameLower.includes(needle) ||
      item.region.toLowerCase().includes(needle)
    ) {
      substringMatches.push(item);
      seen.add(itemNameLower);
    }
  }

  return [...exactMatches, ...prefixMatches, ...substringMatches].slice(0, limit);
}

/**
 * Formats a selected or typed town/city into canonical title-cased string.
 */
export function formatUkCity(value: string | null | undefined): string {
  return normalizeCity(value);
}
