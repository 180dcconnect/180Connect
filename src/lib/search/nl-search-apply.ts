// F214 — Natural Language Charity Search (#209): turning a validated plan into
// an actual result set. Pure, and deliberately built on the F053-F058 filters
// rather than beside them — natural language is a *way of choosing* filters
// here, not a second search engine with its own idea of what "in Leeds" means.
// That is also what makes AC3's fallback honest: the manual filters a CAM drops
// back to are the same code path this just drove.

import {
  filterByCity,
  filterByCountry,
  filterByPriorityScore,
  filterBySector,
  filterByType,
  filterByStatus,
  resolveClientIncomeBand,
  type VisibleClient,
} from "../../app/clients/visible-clients.ts";
import { countryToIso } from "../country-flags.ts";
import { INCOME_BAND_OPTIONS } from "../income-band.ts";
import type { NlSearchPlan } from "./nl-search-plan.ts";

/**
 * A plan as it stands after being checked against the data that actually exists:
 * `cities` holds only cities some organisation is really in, `countries` only
 * codes really present. Anything the model named that the database has never
 * heard of lands in `dropped`, which the UI shows — "we ignored 'Atlantis'" is
 * information, and it is also the plainest possible proof of AC2: a place with
 * no rows behind it cannot become a filter, so it cannot manufacture results.
 */
export type ResolvedNlPlan = {
  cities: string[];
  countries: string[];
  sectors: string[];
  statuses: string[];
  types: string[];
  incomeBands: string[];
  scoreBands: string[];
  keywords: string[];
  unsupported: string[];
  dropped: string[];
};

function normalise(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Matches a place the model named against the cities the list actually holds.
 * Exact first; a whole-word containment ("Leeds" → "Leeds City") second, because
 * register data writes the same place several ways and a CAM who types "Leeds"
 * means all of them. Substring *without* the word boundary is deliberately not
 * used: "Bath" would otherwise pull in "Bathgate".
 */
function matchCity(wanted: string, available: string[]): string[] {
  const target = normalise(wanted);
  if (!target) return [];
  const exact = available.filter((city) => normalise(city) === target);
  if (exact.length > 0) return exact;
  const word = new RegExp(`(^|\\W)${target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\W|$)`, "i");
  return available.filter((city) => word.test(city));
}

/**
 * Grounds a plan in real data. `availableCities` and `availableCountryCodes` come
 * from the rows already loaded for the list, so this costs no extra query and
 * cannot disagree with what the list can display.
 */
export function resolveNlPlan(
  plan: NlSearchPlan,
  availableCities: string[],
  availableCountryCodes: string[],
): ResolvedNlPlan {
  const dropped: string[] = [];

  const cities: string[] = [];
  for (const wanted of plan.cities) {
    const matches = matchCity(wanted, availableCities);
    if (matches.length === 0) {
      dropped.push(wanted);
      continue;
    }
    for (const match of matches) if (!cities.includes(match)) cities.push(match);
  }

  const codes = new Set(availableCountryCodes.map((code) => code.toUpperCase()));
  const countries: string[] = [];
  for (const wanted of plan.countries) {
    const iso = countryToIso(wanted);
    // A country nobody in the list is in would filter every row away. Reported
    // as dropped rather than applied: "no results" is the wrong answer when the
    // honest one is "this list has no organisations there".
    if (!iso || !codes.has(iso)) {
      dropped.push(wanted);
      continue;
    }
    if (!countries.includes(iso)) countries.push(iso);
  }

  return {
    cities,
    countries,
    sectors: plan.sectors,
    statuses: plan.statuses,
    types: plan.types,
    incomeBands: plan.incomeBands,
    scoreBands: plan.scoreBands,
    keywords: plan.keywords,
    unsupported: plan.unsupported,
    dropped,
  };
}

/** True when the resolved plan would narrow or reorder anything. */
export function resolvedPlanIsEmpty(plan: ResolvedNlPlan): boolean {
  return (
    plan.cities.length === 0 &&
    plan.countries.length === 0 &&
    plan.sectors.length === 0 &&
    plan.statuses.length === 0 &&
    plan.types.length === 0 &&
    plan.incomeBands.length === 0 &&
    plan.scoreBands.length === 0 &&
    plan.keywords.length === 0
  );
}

/**
 * Income band as a filter, following F058's rule for unscored clients rather
 * than inventing a new one: a client whose band cannot be worked out at all
 * stays visible. Charity Commission income data is patchy, and dropping every
 * unfiled organisation the moment someone types "small" would hide exactly the
 * grassroots charities the word was reaching for.
 */
export function filterByIncomeBands(
  clients: VisibleClient[],
  bands: string[],
): VisibleClient[] {
  const wanted = bands.filter((band) => (INCOME_BAND_OPTIONS as readonly string[]).includes(band));
  if (wanted.length === 0) return clients;
  return clients.filter((client) => {
    const band = resolveClientIncomeBand(client);
    if (band === null) return true;
    return wanted.includes(band);
  });
}

/** The text a keyword is judged against: what the CAM can see on the row, plus
 *  the sector fields that decide which group it sits in. */
function searchableText(client: VisibleClient): string {
  return [client.legal_name, client.city ?? "", client.sector ?? "", client.sub_sector ?? ""]
    .join(" ")
    .toLowerCase();
}

/** Whole-word, for the same reason matchCity is: "aid" should not match "maiden". */
function keywordHits(client: VisibleClient, keywords: string[]): number {
  if (keywords.length === 0) return 0;
  const text = searchableText(client);
  let hits = 0;
  for (const keyword of keywords) {
    const term = normalise(keyword);
    if (!term) continue;
    const word = new RegExp(`(^|\\W)${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i");
    if (word.test(text)) hits += 1;
  }
  return hits;
}

/**
 * AC4 — the order results come back in.
 *
 * Every row here already satisfies the plan's hard filters, so relevance is
 * decided by the parts the filters could not express: how many of the query's
 * distinctive words the row carries, and whether its size is the size that was
 * asked for. Priority score (F088) breaks the ties, so two equally relevant
 * charities come back best-prospect-first rather than in whatever order Postgres
 * happened to return them. Name last, so the order is stable across renders and
 * pagination never shows the same client on two pages.
 */
export function rankByPlan(
  clients: VisibleClient[],
  plan: ResolvedNlPlan,
): VisibleClient[] {
  const relevance = new Map<string, number>();
  for (const client of clients) {
    let score = keywordHits(client, plan.keywords) * 3;
    if (plan.incomeBands.length > 0) {
      const band = resolveClientIncomeBand(client);
      // An exactly-matching band outranks an unknown one, which outranks a
      // mismatch — the mismatches only survived filterByIncomeBands when the
      // band was unknown, so this is really "confirmed" vs "unconfirmed".
      if (band !== null && plan.incomeBands.includes(band)) score += 2;
    }
    relevance.set(client.id, score);
  }

  return [...clients].sort((a, b) => {
    const byRelevance = (relevance.get(b.id) ?? 0) - (relevance.get(a.id) ?? 0);
    if (byRelevance !== 0) return byRelevance;
    const byScore = (b.priorityScore ?? -1) - (a.priorityScore ?? -1);
    if (byScore !== 0) return byScore;
    return a.legal_name.localeCompare(b.legal_name);
  });
}

/**
 * Applies a resolved plan end to end: narrow with the existing filters, then
 * order what survives. Keywords never narrow — a query is a description, not a
 * boolean expression, and a CAM who writes "youth music project" should get the
 * best matches first rather than nothing at all because no legal_name contains
 * the word "music".
 */
export function applyNlPlan(
  clients: VisibleClient[],
  plan: ResolvedNlPlan,
): VisibleClient[] {
  let matching = clients;
  matching = filterByCity(matching, plan.cities);
  matching = filterByCountry(matching, plan.countries);
  matching = filterByStatus(matching, plan.statuses);
  matching = filterByType(matching, plan.types);
  matching = filterBySector(matching, plan.sectors);
  matching = filterByPriorityScore(matching, plan.scoreBands);
  matching = filterByIncomeBands(matching, plan.incomeBands);
  return rankByPlan(matching, plan);
}
