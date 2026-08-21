// Page fetch for F037 Manual URL Import.
//
// Deliberately a sibling of website-reachability.ts rather than a flag on it. That
// module answers "is this website up", makes a HEAD request and returns a status.
// This one answers "what does this page say", needs the body, and therefore needs a
// byte cap, a content-type check and a decision about what to do with a page that is
// reachable but useless. Merging the two would have put a `wantBody` boolean through
// a function whose whole contract is a small status union.
//
// What is shared, and must stay shared, is the safety model: the same URL format
// check, the same DNS-then-pin transport, the same refusal to follow a redirect to
// a host that has not been checked. A CAM can paste any string into this flow, so
// this is the one place in the product where an end user chooses the destination of
// a server-side request. See website-validation.ts for why the pinning matters.
//
// Structure follows checkWebsite: the decisions live in a dependency-injected
// function that any test can drive, and the production wrapper below supplies the
// real DNS and socket work.

import { validateWebsiteFormat, isPrivateAddress } from "../website-validation.ts";

/**
 * Enough for the markup of a real charity homepage; a hard stop for anything else.
 *
 * Sized against live pages rather than guessed: wildsheffield.com's homepage alone is
 * over 1MB of markup, and truncation costs the footer — which is exactly where the
 * registration numbers are. A cap that reliably cuts off the most valuable part of
 * the page is worse than no cap at all.
 */
export const MAX_PAGE_BYTES = 3_000_000;

const MAX_REDIRECTS = 3;

export type PageResponse = {
  status: number;
  location: string | null;
  contentType: string | null;
  /** Decoded body, already truncated to the byte cap by the transport. */
  body: string;
  /** True when the transport stopped reading because the cap was reached. */
  truncated: boolean;
};

export type FetchedPage = {
  status: "fetched";
  /** What the CAM pasted, normalised. */
  requestedUrl: string;
  /** Where the fetch actually ended up, after redirects (F037: "valid URL with redirects"). */
  finalUrl: string;
  html: string;
  contentType: string;
  truncated: boolean;
};

export type PageFetchFailure = {
  status: "invalid_url" | "unreachable" | "not_html" | "empty";
  requestedUrl: string;
  /** Safe to show a CAM: no status codes, no host errors, no stack (F037 AC11). */
  message: string;
};

export type PageFetchResult = FetchedPage | PageFetchFailure;

export type PageFetchDependencies = {
  resolve: (hostname: string) => Promise<readonly string[]>;
  request: (url: string, pinnedAddress: string) => Promise<PageResponse>;
  onFailure?: (error: unknown, hostname: string) => Promise<void> | void;
};

/**
 * Maps a response the CAM cannot use onto a sentence the CAM can act on.
 *
 * The HTTP status is recorded through onFailure and never returned. AC11 rules out
 * surfacing website errors, and "HTTP 403" is a fact about the server, not about
 * what the CAM should do next.
 */
function unusableResponseMessage(httpStatus: number): string {
  if (httpStatus === 404 || httpStatus === 410) {
    return "That page does not exist on this website. Check the address and try again.";
  }
  if (httpStatus === 401 || httpStatus === 403) {
    return "This website would not let us read that page. You can still enter the details by hand.";
  }
  if (httpStatus === 429) {
    return "This website is asking us to slow down. Try again in a few minutes.";
  }
  if (httpStatus >= 500) {
    return "This website is not responding properly at the moment. Try again later.";
  }
  return "This website did not return a page we could read.";
}

function isHtml(contentType: string | null): boolean {
  if (!contentType) return false;
  const essence = contentType.split(";")[0].trim().toLowerCase();
  return essence === "text/html" || essence === "application/xhtml+xml";
}

/**
 * Fetches one page, following redirects only to destinations that pass the same
 * checks as the original URL.
 *
 * Every failure returns a value rather than throwing. The caller is a CAM-facing
 * import flow whose whole job is to explain what went wrong (F256), so a failure is
 * an ordinary outcome here, not an exception.
 */
export async function fetchPage(
  value: string | null | undefined,
  dependencies: PageFetchDependencies,
): Promise<PageFetchResult> {
  const format = validateWebsiteFormat(value);
  if (format.status !== "valid") {
    return {
      status: "invalid_url",
      requestedUrl: format.url ?? "",
      message: format.status === "missing"
        ? "Enter the website address you want to import from."
        : "That does not look like a website address we can open. It should start with https:// and name a public site.",
    };
  }

  const requestedUrl = format.url;
  let current = requestedUrl;

  try {
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
      const currentUrl = new URL(current);
      const addresses = await dependencies.resolve(currentUrl.hostname);
      if (addresses.length === 0 || addresses.some(isPrivateAddress)) {
        await dependencies.onFailure?.(
          new Error(
            addresses.length === 0
              ? "Import hostname did not resolve"
              : "Import hostname resolved to a private address",
          ),
          currentUrl.hostname,
        );
        return {
          status: "unreachable",
          requestedUrl,
          message: "We could not reach that website. Check the address, or enter the details by hand.",
        };
      }

      // Pin the transport to the address just validated — a second, independent DNS
      // lookup inside the request would reopen the rebinding hole that check closes.
      const response = await dependencies.request(current, addresses[0]);

      if (response.status >= 300 && response.status < 400) {
        const location = response.location;
        if (!location || redirects === MAX_REDIRECTS) break;
        const redirected = new URL(location, current).toString();
        const redirectedFormat = validateWebsiteFormat(redirected);
        if (redirectedFormat.status !== "valid") {
          await dependencies.onFailure?.(
            new Error("Import redirected to an unsafe or malformed destination"),
            currentUrl.hostname,
          );
          break;
        }
        current = redirectedFormat.url;
        continue;
      }

      if (response.status < 200 || response.status >= 300) {
        await dependencies.onFailure?.(
          new Error(`Import fetch returned HTTP ${response.status}`),
          currentUrl.hostname,
        );
        return {
          status: "unreachable",
          requestedUrl,
          message: unusableResponseMessage(response.status),
        };
      }

      if (!isHtml(response.contentType)) {
        await dependencies.onFailure?.(
          new Error(`Import fetch returned content-type ${response.contentType ?? "none"}`),
          currentUrl.hostname,
        );
        return {
          status: "not_html",
          requestedUrl,
          message: "That address is a file rather than a web page. Paste the organisation's website address instead.",
        };
      }

      if (response.body.trim().length === 0) {
        return {
          status: "empty",
          requestedUrl,
          message: "That page was empty, so there was nothing to import. You can enter the details by hand.",
        };
      }

      return {
        status: "fetched",
        requestedUrl,
        finalUrl: current,
        html: response.body,
        contentType: response.contentType ?? "text/html",
        truncated: response.truncated,
      };
    }
  } catch (error) {
    // The real diagnostic goes to ERROR_LOG through onFailure; the CAM gets the
    // sentence below. Returning here rather than falling through keeps a single
    // failure from being logged twice under two different explanations.
    await dependencies.onFailure?.(error, new URL(current).hostname);
    return {
      status: "unreachable",
      requestedUrl,
      message: "We could not read that website. Check the address, or enter the details by hand.",
    };
  }

  await dependencies.onFailure?.(
    new Error("Import exceeded the redirect limit or returned an unusable redirect"),
    new URL(current).hostname,
  );
  return {
    status: "unreachable",
    requestedUrl,
    message: "That address redirected too many times for us to follow. Try the address it ends up on.",
  };
}
