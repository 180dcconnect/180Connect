// Reading a mission off an organisation's own website.
//
// ── Why this quotes rather than generates ──
//
// An ordinary limited company publishes no purpose statement anywhere. That is
// a real fact about the data, not a gap, and the temptation is to close it with
// a model: hand it the site and ask for a sentence. F037 already settled this
// the other way and the reasoning still holds — a model that infers a mission
// from body copy produces something fluent and unattributable, while a
// description the site wrote about itself is at least a quote. The record then
// carries a sentence somebody can check against the page it came from.
//
// So the only thing this reads is the description the page publishes about
// itself: JSON-LD `description` first, then og:description / meta description /
// twitter:description (see extractOrganisation's ordering). No model call, no
// body-copy summarising, and nothing inferred. When the page publishes no
// description, the honest outcome is "nothing to propose" — not a guess.
//
// ── What it does not do ──
//
// It writes nothing. It returns a proposal for a human to read, edit and save
// through the record's existing admin edit path, which is where a mission on an
// existing record has always been written. That keeps the approval step real and
// the write surface unchanged.
//
// The page text is externally authored, so the returned string is untrusted
// input everywhere downstream — the same contract as every other register or
// website value that reaches a model (PRD §11.5).

import { fetchImportPage } from "./import/page-transport.ts";
import type { PageFetchResult } from "./import/fetch-page.ts";
import { extractOrganisation } from "./import/extract-organisation.ts";

/**
 * The most a mission is allowed to be, in characters. The same 5000 the manual
 * entry column accepts is far more than a purpose statement needs — a meta
 * description runs to a few hundred — so this is a sanity bound on a page that
 * published something enormous, not a house style.
 */
export const MISSION_MAX_LENGTH = 2_000;

/**
 * Below this, the "description" is page furniture rather than a purpose: sites
 * ship `content="Home"`, `content="Blog"` and similar on template pages. The
 * test is on length alone because the alternative — a blocklist of generic
 * words — would start refusing real descriptions that happen to be short.
 */
export const MIN_MISSION_LENGTH = 20;

export type MissionProposal =
  | {
      status: "proposed";
      /** The site's own description of itself, trimmed and length-capped. */
      mission: string;
      /** Where it was read from, after redirects. Recorded, not shown raw. */
      sourceUrl: string;
      hostname: string;
    }
  | { status: "skipped"; reason: string };

export type MissionLookupDependencies = {
  fetchPage: (value: string | null | undefined) => Promise<PageFetchResult>;
};

function normalizeForComparison(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * Fetches one page through F037's shared, robots-aware, SSRF-safe transport and
 * returns the description it publishes about itself.
 *
 * Never throws — an unreachable, blocked or undescribing site is an ordinary
 * outcome the caller shows to a human, same contract as fetchWebsiteContext.
 */
export async function proposeMissionFromWebsite(
  url: string | null | undefined,
  legalName: string | null,
  deps: MissionLookupDependencies,
): Promise<MissionProposal> {
  const result = await deps.fetchPage(url);
  if (result.status !== "fetched") {
    // page-transport's failure messages are already written to be read by a
    // person (F037 AC11: no status codes, no host errors), so they pass through.
    return { status: "skipped", reason: result.message };
  }

  const extracted = extractOrganisation(result.html, result.finalUrl);
  const description = extracted.missionStatement?.trim();
  if (!description) {
    return {
      status: "skipped",
      reason:
        "That page does not describe what this client does — it publishes no description of itself. You can still write a mission by hand.",
    };
  }

  if (description.length < MIN_MISSION_LENGTH) {
    return {
      status: "skipped",
      reason:
        "The description that page publishes is too short to be a purpose statement. You can still write a mission by hand.",
    };
  }

  // Some sites set their meta description to the organisation's own name. That
  // is identity, not purpose, and saving it would light the mission tick with
  // text a reader already has two rows above it.
  if (legalName && normalizeForComparison(description) === normalizeForComparison(legalName)) {
    return {
      status: "skipped",
      reason:
        "That page only repeats the client's name back — it says nothing about what it does. You can still write a mission by hand.",
    };
  }

  let hostname: string;
  try {
    hostname = new URL(result.finalUrl).hostname.replace(/^www\./, "");
  } catch {
    return { status: "skipped", reason: "That website address could not be read." };
  }

  return {
    status: "proposed",
    mission:
      description.length > MISSION_MAX_LENGTH
        ? description.slice(0, MISSION_MAX_LENGTH).trimEnd()
        : description,
    sourceUrl: result.finalUrl,
    hostname,
  };
}

/** Production wrapper; the decision logic stays injectable and unit-testable above. */
export function createDefaultMissionLookupDependencies(): MissionLookupDependencies {
  return { fetchPage: fetchImportPage };
}
