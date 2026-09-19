import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { PageFetchResult } from "./import/fetch-page.ts";
import { SECTOR_TAXONOMY, scoreBySector } from "./scoring/score-by-sector.ts";
import {
  classifySectorFromText,
  proposeSectorFromWebsite,
  SECTOR_TERMS,
  type SectorLookupDependencies,
} from "./sector-from-website.ts";

// ---------------------------------------------------------------------------
// The transport is injected, so these drive the decision logic without a
// network — same split as mission-from-website.test.ts.
// ---------------------------------------------------------------------------

function depsFor(result: PageFetchResult): SectorLookupDependencies {
  return { fetchPage: async () => result };
}

function fetched(html: string, finalUrl = "https://www.example.org/"): PageFetchResult {
  return {
    status: "fetched",
    requestedUrl: "https://example.org",
    finalUrl,
    html,
    contentType: "text/html",
    truncated: false,
  };
}

function pageDescribing(description: string): string {
  return `<html><head><meta property="og:description" content="${description}"></head><body></body></html>`;
}

describe("SECTOR_TERMS covers the taxonomy the rest of the app reads", () => {
  it("names every preset in SECTOR_TAXONOMY, and invents none of its own", () => {
    const presets = Object.values(SECTOR_TAXONOMY).flat().slice().sort();
    assert.deepEqual(Object.keys(SECTOR_TERMS).slice().sort(), presets);
  });

  it("proposes only values the scorer recognises — the bug that made this worth doing", () => {
    for (const sector of Object.keys(SECTOR_TERMS)) {
      const result = scoreBySector(sector);
      assert.equal(result.matchedTaxonomy, true, `${sector} does not match the scorer's taxonomy`);
    }
  });

  it("keeps every term long enough that its prefix match cannot fire inside a word", () => {
    for (const [sector, terms] of Object.entries(SECTOR_TERMS)) {
      for (const term of terms) {
        assert.ok(term.length >= 4, `${sector}: "${term}" is too short to match safely`);
        assert.equal(term, term.toLowerCase(), `${sector}: "${term}" should be lowercase`);
      }
    }
  });
});

describe("classifySectorFromText", () => {
  it("reads the sector a charity's own words point at", () => {
    const match = classifySectorFromText(
      "We support people sleeping rough across the city, running a night shelter and helping people into stable housing.",
    );
    assert.equal(match?.sector, "Housing & Homelessness");
    assert.equal(match?.category, "Poverty & Community");
    assert.ok(match!.matchedTerms.length >= 2);
  });

  it("carries back the words it matched, so a wrong proposal reads as wrong", () => {
    const match = classifySectorFromText(
      "A community football and cricket club offering coaching to children across Rotherham.",
    );
    assert.equal(match?.sector, "Sports & Recreation");
    assert.ok(match!.matchedTerms.includes("football"));
    assert.ok(match!.matchedTerms.includes("cricket"));
  });

  it("proposes nothing when two sectors have equal evidence", () => {
    // One term each: "museum" (Heritage & Museums) and "theatre" (Arts &
    // Culture). Equal evidence is the case this refuses rather than breaks.
    const match = classifySectorFromText(
      "Our museum and our theatre sit at either end of the same high street in town.",
    );
    assert.equal(match, null);
  });

  it("proposes nothing for words that point at no sector at all", () => {
    assert.equal(
      classifySectorFromText(
        "An organisation working across the region since 1994 with a small dedicated team.",
      ),
      null,
    );
  });

  it("proposes nothing for a page with almost no words on it", () => {
    assert.equal(classifySectorFromText("Welcome!"), null);
    assert.equal(classifySectorFromText(""), null);
    assert.equal(classifySectorFromText(null), null);
  });

  it("never fires a term inside a longer word", () => {
    // "arts" must not match "parts", "sport" must not match "passport".
    assert.equal(
      classifySectorFromText(
        "We supply replacement parts and check every passport application carefully for our members.",
      ),
      null,
    );
  });

  it("matches a term's own suffixes, so one entry covers the word's family", () => {
    const match = classifySectorFromText(
      "Tackling homelessness in South Yorkshire through outreach to people rough sleeping in the city centre.",
    );
    assert.equal(match?.sector, "Housing & Homelessness");
  });
});

describe("proposeSectorFromWebsite", () => {
  it("proposes the sector, where it lands, and the sentence it read it from", async () => {
    const description =
      "We are a hospice providing palliative nursing care to patients and their carers across the district.";
    const result = await proposeSectorFromWebsite(
      "https://example.org",
      "St Luke's Hospice",
      depsFor(fetched(pageDescribing(description))),
    );

    assert.equal(result.status, "proposed");
    if (result.status !== "proposed") return;
    assert.equal(result.sector, "Health & Social Care");
    assert.equal(result.category, "Health & Wellbeing");
    assert.equal(result.hostname, "example.org");
    assert.equal(result.evidence, description);
    assert.ok(result.matchedTerms.includes("hospice"));
  });

  it("reads the client's name as evidence alongside the description", async () => {
    // The description alone points nowhere; the name carries "woodland" and
    // "conservation", and the proposal follows them.
    const result = await proposeSectorFromWebsite(
      "https://example.org",
      "Sheffield Woodland Conservation Trust",
      depsFor(
        fetched(
          pageDescribing(
            "Caring for the green spaces that surround our city, with volunteers out every weekend of the year.",
          ),
        ),
      ),
    );
    assert.equal(result.status, "proposed");
    if (result.status !== "proposed") return;
    assert.equal(result.sector, "Environment & Conservation");
  });

  it("passes the transport's own sentence through when a page cannot be read", async () => {
    const result = await proposeSectorFromWebsite(
      "https://example.org",
      null,
      depsFor({
        status: "unreachable",
        requestedUrl: "https://example.org",
        message: "That website could not be reached.",
      }),
    );
    assert.equal(result.status, "skipped");
    if (result.status !== "skipped") return;
    assert.equal(result.reason, "That website could not be reached.");
  });

  it("says so plainly when the page describes nothing", async () => {
    const result = await proposeSectorFromWebsite(
      "https://example.org",
      null,
      depsFor(fetched("<html><head></head><body>Hello</body></html>")),
    );
    assert.equal(result.status, "skipped");
    if (result.status !== "skipped") return;
    assert.match(result.reason, /does not describe/);
  });

  it("says so plainly when the words point at no one sector", async () => {
    const result = await proposeSectorFromWebsite(
      "https://example.org",
      null,
      depsFor(
        fetched(
          pageDescribing(
            "An organisation working across the region since 1994 with a small and dedicated team of staff.",
          ),
        ),
      ),
    );
    assert.equal(result.status, "skipped");
    if (result.status !== "skipped") return;
    assert.match(result.reason, /does not point clearly at one sector/);
  });
});
