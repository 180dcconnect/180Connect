import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  extractReadableText,
  fetchWebsiteContext,
  type ScrapeDependencies,
} from "./scrape-website.ts";
import type { PageFetchResult } from "../import/fetch-page.ts";

function dependencies(result: PageFetchResult): ScrapeDependencies {
  return { fetchPage: async () => result };
}

describe("extractReadableText", () => {
  it("strips tags, scripts, and styles down to plain text", () => {
    const html = `
      <html><head><style>.a{color:red}</style></head>
      <body>
        <script>trackStuff();</script>
        <nav>Home | About</nav>
        <h1>Test Charity</h1>
        <p>We run weekly youth clubs &amp; training sessions.</p>
      </body></html>
    `;
    const text = extractReadableText(html);
    assert.doesNotMatch(text, /trackStuff/);
    assert.doesNotMatch(text, /color:red/);
    assert.match(text, /Test Charity/);
    assert.match(text, /We run weekly youth clubs & training sessions\./);
  });

  it("returns an empty string for markup with no visible text", () => {
    assert.equal(extractReadableText("<html><head><script>x()</script></head><body></body></html>"), "");
  });
});

describe("fetchWebsiteContext", () => {
  it("returns extracted text and the final hostname on a successful fetch", async () => {
    const result = await fetchWebsiteContext(
      "https://test-charity.org",
      dependencies({
        status: "fetched",
        requestedUrl: "https://test-charity.org",
        finalUrl: "https://test-charity.org/home",
        html: "<p>We support young people into work.</p>",
        contentType: "text/html",
        truncated: false,
      }),
    );
    assert.deepEqual(result, {
      status: "used",
      text: "We support young people into work.",
      hostname: "test-charity.org",
    });
  });

  it("skips a missing URL via the shared validator's missing state", async () => {
    const received: (string | null | undefined)[] = [];
    const result = await fetchWebsiteContext(null, {
      fetchPage: async (value) => {
        received.push(value);
        return { status: "invalid_url", requestedUrl: "", message: "bad" };
      },
    });
    assert.deepEqual(received, [null]);
    assert.deepEqual(result, { status: "skipped", reason: "That URL's format looks invalid." });
  });

  it("skips a malformed URL, reporting the format failure", async () => {
    const result = await fetchWebsiteContext(
      "not a url",
      dependencies({ status: "invalid_url", requestedUrl: "not a url", message: "bad url" }),
    );
    assert.deepEqual(result, { status: "skipped", reason: "That URL's format looks invalid." });
  });

  it("skips an unreachable site, passing through the CAM-facing message (incl. robots refusals)", async () => {
    const robotsMessage =
      "This website asks automated tools not to read that page, so nothing was imported. " +
      "You can still enter the details by hand.";
    const result = await fetchWebsiteContext(
      "https://test-charity.org",
      dependencies({ status: "unreachable", requestedUrl: "https://test-charity.org", message: robotsMessage }),
    );
    assert.deepEqual(result, { status: "skipped", reason: robotsMessage });
  });

  it("skips a non-HTML response", async () => {
    const result = await fetchWebsiteContext(
      "https://test-charity.org/file.pdf",
      dependencies({ status: "not_html", requestedUrl: "https://test-charity.org/file.pdf", message: "not html" }),
    );
    assert.deepEqual(result, { status: "skipped", reason: "not html" });
  });

  it("skips when the resolved page has no readable text", async () => {
    const result = await fetchWebsiteContext(
      "https://test-charity.org",
      dependencies({
        status: "fetched",
        requestedUrl: "https://test-charity.org",
        finalUrl: "https://test-charity.org",
        html: "<script>onlyJs()</script>",
        contentType: "text/html",
        truncated: false,
      }),
    );
    assert.deepEqual(result, {
      status: "skipped",
      reason: "The page did not contain readable text content.",
    });
  });

  it("caps extracted text at the context limit so it cannot dominate the prompt budget", async () => {
    const filler = "word ".repeat(20_000);
    const result = await fetchWebsiteContext(
      "https://test-charity.org",
      dependencies({
        status: "fetched",
        requestedUrl: "https://test-charity.org",
        finalUrl: "https://test-charity.org",
        html: `<p>${filler}</p>`,
        contentType: "text/html",
        truncated: false,
      }),
    );
    assert.equal(result.status, "used");
    assert.ok((result as { text: string }).text.length <= 6_000);
  });
});
