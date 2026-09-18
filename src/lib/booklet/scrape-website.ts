// F084 — Use Website URL in Booklet: fetches a CAM-pasted URL and extracts plain
// text to add as context for the Gemini call in generate-booklet.ts.
//
// The network half is not duplicated here. F037's fetchImportPage
// (../import/page-transport.ts) already does everything this needs — the F046 URL
// format check, the robots.txt check (with a redirect-aware second check), the same
// DNS-pinned SSRF-safe transport, bounded redirects and byte cap — and reports its
// own failures to ERROR_LOG. This file only adapts that result to the shape the
// booklet flow wants: readable text plus the hostname, or a skip reason.
//
// AC3: an unreachable, blocked, or unscrapable site must never block booklet
// generation, only skip the extra context — so this never throws, same contract as
// generate-booklet.ts's generateBooklet.

import { fetchImportPage } from "../import/page-transport.ts";
import type { PageFetchResult } from "../import/fetch-page.ts";

// Keeps the scraped text from dominating the Gemini prompt budget alongside the
// profile fields build-prompt.ts already sends — see that file's own token-cost note.
const MAX_CONTEXT_CHARS = 6_000;

export type WebsiteContext =
  | { status: "used"; text: string; hostname: string }
  | { status: "skipped"; reason: string };

export type ScrapeDependencies = {
  fetchPage: (value: string | null | undefined) => Promise<PageFetchResult>;
};

/** CAM-facing reason for each failure state page-transport can report. */
function reasonFor(result: PageFetchResult & { status: "invalid_url" | "unreachable" | "not_html" | "empty" }): string {
  switch (result.status) {
    case "invalid_url":
      return "That URL's format looks invalid.";
    // "unreachable" also covers a robots.txt refusal — page-transport's message for
    // that case ("asks automated tools not to read that page") is already written to
    // be shown to a CAM, so it passes through unchanged.
    default:
      return result.message;
  }
}

/**
 * Fetches and extracts context from a CAM-supplied URL via F037's shared,
 * robots-aware, SSRF-safe transport. Never throws — a malformed, unreachable, or
 * unscrapable URL is reported as `{ status: "skipped", reason }` so generation can
 * proceed without it (AC3), not treated as a hard failure of the booklet request.
 */
export async function fetchWebsiteContext(
  value: string | null | undefined,
  deps: ScrapeDependencies,
): Promise<WebsiteContext> {
  const result = await deps.fetchPage(value);
  if (result.status !== "fetched") {
    return { status: "skipped", reason: reasonFor(result) };
  }

  const text = extractReadableText(result.html).slice(0, MAX_CONTEXT_CHARS);
  if (!text) {
    return { status: "skipped", reason: "The page did not contain readable text content." };
  }
  return { status: "used", text, hostname: new URL(result.finalUrl).hostname };
}

/**
 * Strips a lightweight HTML document down to readable text. Not a real HTML
 * parser — no new dependency for what's ultimately best-effort LLM context, not a
 * rendered view — so it can be fooled by unusual markup; that's an acceptable
 * quality trade-off here, not a correctness requirement.
 */
export function extractReadableText(html: string): string {
  const withoutNonContent = html
    .replace(/<(script|style|noscript|template)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
  const withoutTags = withoutNonContent.replace(/<[^>]+>/g, " ");
  const decoded = withoutTags
    .replace(/&nbsp;/gi, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_match, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"");
  return decoded.replace(/[ \t\f\v]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
}

/** Production wrapper; decision logic stays injectable and unit-testable above. */
export function createDefaultScrapeDependencies(): ScrapeDependencies {
  return { fetchPage: fetchImportPage };
}
