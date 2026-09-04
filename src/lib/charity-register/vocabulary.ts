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
  { value: "Education/training", label: "Education & training", approxCount: 135_061 },
  { value: "General Charitable Purposes", label: "General charitable purposes", approxCount: 88_580 },
  { value: "The Prevention Or Relief Of Poverty", label: "Preventing or relieving poverty", approxCount: 52_718 },
  { value: "Religious Activities", label: "Religious activities", approxCount: 51_291 },
  { value: "The Advancement Of Health Or Saving Of Lives", label: "Health & saving lives", approxCount: 45_477 },
  { value: "Arts/culture/heritage/science", label: "Arts, culture, heritage & science", approxCount: 44_915 },
  { value: "Disability", label: "Disability", approxCount: 42_483 },
  { value: "Amateur Sport", label: "Amateur sport", approxCount: 39_854 },
  { value: "Economic/community Development/employment", label: "Community development & employment", approxCount: 34_457 },
  { value: "Environment/conservation/heritage", label: "Environment & conservation", approxCount: 28_105 },
  { value: "Recreation", label: "Recreation", approxCount: 21_198 },
  { value: "Other Charitable Purposes", label: "Other charitable purposes", approxCount: 20_049 },
  { value: "Overseas Aid/famine Relief", label: "Overseas aid & famine relief", approxCount: 15_308 },
  { value: "Accommodation/housing", label: "Accommodation & housing", approxCount: 12_569 },
  { value: "Human Rights/religious Or Racial Harmony/equality Or Diversity", label: "Human rights & equality", approxCount: 8_775 },
  { value: "Animals", label: "Animals", approxCount: 6_551 },
  { value: "Armed Forces/emergency Service Efficiency", label: "Armed forces & emergency services", approxCount: 1_350 },
];

/** "Who the charity helps" — 7 values. Never previously filterable at all. */
export const WHO_CLASSIFICATIONS: readonly VocabularyEntry[] = [
  { value: "Children/young People", label: "Children & young people", approxCount: 149_200 },
  { value: "The General Public/mankind", label: "The general public", approxCount: 132_125 },
  { value: "Elderly/old People", label: "Elderly people", approxCount: 77_330 },
  { value: "People With Disabilities", label: "People with disabilities", approxCount: 72_808 },
  { value: "Other Charities Or Voluntary Bodies", label: "Other charities & voluntary bodies", approxCount: 62_084 },
  { value: "Other Defined Groups", label: "Other defined groups", approxCount: 44_121 },
  { value: "People Of A Particular Ethnic Or Racial Origin", label: "A particular ethnic or racial origin", approxCount: 24_086 },
];

/** "How the charity works" — 10 values. Also never previously filterable. */
export const HOW_CLASSIFICATIONS: readonly VocabularyEntry[] = [
  { value: "Provides Services", label: "Provides services", approxCount: 111_172 },
  { value: "Provides Buildings/facilities/open Space", label: "Provides buildings & facilities", approxCount: 75_306 },
  { value: "Makes Grants To Organisations", label: "Makes grants to organisations", approxCount: 74_538 },
  { value: "Provides Advocacy/advice/information", label: "Advocacy, advice & information", approxCount: 73_018 },
  { value: "Makes Grants To Individuals", label: "Makes grants to individuals", approxCount: 54_131 },
  { value: "Provides Human Resources", label: "Provides human resources", approxCount: 48_680 },
  { value: "Other Charitable Activities", label: "Other charitable activities", approxCount: 37_312 },
  { value: "Acts As An Umbrella Or Resource Body", label: "Umbrella or resource body", approxCount: 23_292 },
  { value: "Sponsors Or Undertakes Research", label: "Sponsors or undertakes research", approxCount: 20_220 },
  { value: "Provides Other Finance", label: "Provides other finance", approxCount: 16_664 },
];

/**
 * The four regions the register uses. Countries (275 of them) and the full 174
 * local authorities are loaded from the snapshot instead of listed here — a
 * hardcoded list of 174 place names is exactly the kind of thing that goes stale
 * and starts quietly excluding somewhere.
 */
export const REGIONS: readonly string[] = [
  "Yorkshire And The Humber",
  "North West",
  "North East",
  "Throughout England And Wales",
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

/** Postcode areas offered as quick picks. Any area can be typed. */
export const SUGGESTED_POSTCODE_AREAS: readonly string[] = ["S", "DN"];

/**
 * Income steps for the range control, chosen to match how charity size is
 * actually talked about rather than as even intervals. `null` is "no limit".
 */
export const INCOME_STEPS: readonly (number | null)[] = [
  0, 10_000, 25_000, 50_000, 100_000, 250_000, 500_000, 1_000_000, 5_000_000, null,
];
