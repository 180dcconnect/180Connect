import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { PageFetchResult } from "./import/fetch-page.ts";
import {
  MISSION_MAX_LENGTH,
  proposeMissionFromWebsite,
  type MissionLookupDependencies,
} from "./mission-from-website.ts";

// ---------------------------------------------------------------------------
// The transport is injected, so these drive the decision logic without a
// network — same split as scrape-website.test.ts and extract-organisation.ts:
// the part that can be wrong in interesting ways is assertable without a
// fixture server.
// ---------------------------------------------------------------------------

function depsFor(result: PageFetchResult, seen?: { url: string | null | undefined }): MissionLookupDependencies {
  return {
    fetchPage: async (value) => {
      if (seen) seen.url = value;
      return result;
    },
  };
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

const LONG_DESCRIPTION =
  "We run community food-growing projects across the borough, teaching practical horticulture skills and sharing the harvest with local food banks.";

function pageWithMeta(description: string): string {
  return `<!doctype html><html><head><title>Example</title><meta name="description" content="${description}"></head><body><p>hello</p></body></html>`;
}

describe("proposeMissionFromWebsite", () => {
  it("proposes the description the page publishes about itself", async () => {
    const result = await proposeMissionFromWebsite(
      "https://example.org",
      "Example Trust",
      depsFor(fetched(pageWithMeta(LONG_DESCRIPTION))),
    );

    assert.equal(result.status, "proposed");
    if (result.status !== "proposed") return;
    assert.equal(result.mission, LONG_DESCRIPTION);
    assert.equal(result.sourceUrl, "https://www.example.org/");
    // www is dropped so the host reads as the site a person knows.
    assert.equal(result.hostname, "example.org");
  });

  it("prefers the structured-data description over the meta tag", async () => {
    const html = `<!doctype html><html><head>
      <meta name="description" content="${LONG_DESCRIPTION}">
      <script type="application/ld+json">
        {"@type":"Organization","description":"A machine-readable purpose the site published first."}
      </script>
      </head><body></body></html>`;

    const result = await proposeMissionFromWebsite("https://example.org", null, depsFor(fetched(html)));

    assert.equal(result.status, "proposed");
    if (result.status !== "proposed") return;
    assert.equal(result.mission, "A machine-readable purpose the site published first.");
  });

  it("hands the page's own description through untouched", async () => {
    // A quote, not a paraphrase: whatever the site wrote is what is proposed.
    const quoted = "We are a resident-led charity. We run the community kitchen & the winter warm hub.";
    const result = await proposeMissionFromWebsite(
      "https://example.org",
      null,
      depsFor(fetched(pageWithMeta(quoted))),
    );

    assert.equal(result.status, "proposed");
    if (result.status !== "proposed") return;
    assert.equal(result.mission, quoted);
  });

  it("skips a page that publishes no description", async () => {
    const result = await proposeMissionFromWebsite(
      "https://example.org",
      null,
      depsFor(fetched("<!doctype html><html><head><title>Example</title></head><body>hello</body></html>")),
    );

    assert.equal(result.status, "skipped");
    if (result.status !== "skipped") return;
    assert.match(result.reason, /does not describe/);
  });

  it("skips template furniture that is not a purpose statement", async () => {
    const result = await proposeMissionFromWebsite(
      "https://example.org",
      null,
      depsFor(fetched(pageWithMeta("Home"))),
    );

    assert.equal(result.status, "skipped");
    if (result.status !== "skipped") return;
    assert.match(result.reason, /too short/);
  });

  it("skips a description that only repeats the client's name", async () => {
    const result = await proposeMissionFromWebsite(
      "https://example.org",
      "Example Community Trust",
      depsFor(fetched(pageWithMeta("Example Community Trust"))),
    );

    assert.equal(result.status, "skipped");
    if (result.status !== "skipped") return;
    assert.match(result.reason, /repeats the client's name/);
  });

  it("caps a description that runs past the mission bound", async () => {
    const huge = "A".repeat(MISSION_MAX_LENGTH + 500);
    const result = await proposeMissionFromWebsite(
      "https://example.org",
      null,
      depsFor(fetched(pageWithMeta(huge))),
    );

    assert.equal(result.status, "proposed");
    if (result.status !== "proposed") return;
    assert.equal(result.mission.length, MISSION_MAX_LENGTH);
  });

  it("passes a transport failure through as the reason, without throwing", async () => {
    const result = await proposeMissionFromWebsite(
      "not a url",
      null,
      depsFor({
        status: "invalid_url",
        requestedUrl: "",
        message: "That does not look like a website address we can open. It should start with https:// and name a public site.",
      }),
    );

    assert.equal(result.status, "skipped");
    if (result.status !== "skipped") return;
    assert.match(result.reason, /https:\/\//);
  });

  it("shows the CAM-facing wording of a blocked site", async () => {
    const result = await proposeMissionFromWebsite(
      "https://example.org",
      null,
      depsFor({
        status: "unreachable",
        requestedUrl: "https://example.org",
        message: "This website asks automated tools not to read that page.",
      }),
    );

    assert.equal(result.status, "skipped");
    if (result.status !== "skipped") return;
    assert.match(result.reason, /automated tools/);
  });

  it("asks the transport for the URL it was given", async () => {
    const seen = { url: null as string | null | undefined };
    await proposeMissionFromWebsite("https://example.org/about", null, depsFor(fetched(pageWithMeta(LONG_DESCRIPTION)), seen));

    assert.equal(seen.url, "https://example.org/about");
  });

  it("uses the redirected address as the source it read", async () => {
    const result = await proposeMissionFromWebsite(
      "http://example.org",
      null,
      depsFor(fetched(pageWithMeta(LONG_DESCRIPTION), "https://www.example.org/home")),
    );

    assert.equal(result.status, "proposed");
    if (result.status !== "proposed") return;
    assert.equal(result.sourceUrl, "https://www.example.org/home");
    assert.equal(result.hostname, "example.org");
  });
});
