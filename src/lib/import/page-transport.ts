// The real network half of F037's page fetch. fetch-page.ts holds the decisions;
// this holds the socket, the byte cap and the character decoding.
//
// Node's http/https rather than global fetch, for the same reason
// website-reachability.ts uses them: `lookup` is the only hook that lets the URL keep
// its hostname (so Host and TLS SNI stay correct) while the TCP connection is pinned
// to an address that has already been checked. `fetch` gives no such hook, so a
// second DNS answer could send the request somewhere the safety check never saw.

import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { StringDecoder } from "node:string_decoder";

import { reportError } from "../error-logging.ts";
import { pinnedLookup, resolvePublicAddresses } from "../website-reachability.ts";
import { validateWebsiteFormat } from "../website-validation.ts";
import {
  fetchPage,
  MAX_PAGE_BYTES,
  type PageFetchResult,
  type PageResponse,
} from "./fetch-page.ts";
import { IMPORT_USER_AGENT, IMPORT_USER_AGENT_TOKEN, isPathAllowedByRobots } from "./robots.ts";

const HTTP_TIMEOUT_MS = 8_000;
const ROBOTS_TIMEOUT_MS = 4_000;
const MAX_ROBOTS_BYTES = 64_000;

/**
 * Charset from the Content-Type header, falling back to utf-8.
 *
 * Node's StringDecoder handles the encodings that matter here; a page declaring
 * something exotic (say windows-1252) decodes as utf-8, which mangles a handful of
 * punctuation characters and nothing structural. That is an acceptable trade against
 * pulling in an encoding library for a field the CAM reviews by eye anyway.
 */
function decoderFor(contentType: string | null): StringDecoder {
  const declared = contentType?.match(/charset=([^;]+)/i)?.[1]?.trim().toLowerCase();
  const supported = declared === "latin1" || declared === "ascii" || declared === "utf-8"
    ? declared
    : "utf8";
  return new StringDecoder(supported === "utf-8" ? "utf8" : supported);
}

type BodyRequestOptions = { maxBytes: number; timeoutMs: number; accept: string };

function requestPinnedBody(
  url: string,
  address: string,
  options: BodyRequestOptions,
): Promise<PageResponse> {
  const target = new URL(url);
  const family = isIP(address);
  if (family !== 4 && family !== 6) {
    return Promise.reject(new Error("Resolved address is not an IP"));
  }

  return new Promise<PageResponse>((resolve, reject) => {
    const request = (target.protocol === "https:" ? httpsRequest : httpRequest)(
      target,
      {
        method: "GET",
        headers: {
          Host: target.host,
          "User-Agent": IMPORT_USER_AGENT,
          Accept: options.accept,
          "Accept-Language": "en-GB,en;q=0.9",
        },
        lookup: pinnedLookup(address, family),
      },
      (response) => {
        const status = response.statusCode ?? 0;
        const contentType = typeof response.headers["content-type"] === "string"
          ? response.headers["content-type"]
          : null;
        const location = typeof response.headers.location === "string"
          ? response.headers.location
          : null;

        // A redirect's body is of no interest, and reading it wastes the transfer.
        if (status >= 300 && status < 400) {
          response.resume();
          resolve({ status, location, contentType, body: "", truncated: false });
          return;
        }

        const decoder = decoderFor(contentType);
        let body = "";
        let bytes = 0;
        let truncated = false;

        response.on("data", (chunk: Buffer) => {
          if (truncated) return;
          const remaining = options.maxBytes - bytes;
          if (chunk.length >= remaining) {
            body += decoder.write(chunk.subarray(0, remaining));
            bytes = options.maxBytes;
            truncated = true;
            // Stop the transfer rather than reading a 200MB response into memory and
            // throwing most of it away. destroy() emits 'close', not 'error'.
            response.destroy();
            return;
          }
          body += decoder.write(chunk);
          bytes += chunk.length;
        });

        response.on("end", () => {
          body += decoder.end();
          resolve({ status, location, contentType, body, truncated });
        });
        response.on("close", () => {
          if (truncated) resolve({ status, location, contentType, body, truncated });
        });
        response.on("error", reject);
      },
    );

    request.setTimeout(options.timeoutMs, () => {
      request.destroy(new Error("Import request timed out"));
    });
    request.on("error", reject);
    request.end();
  });
}

/**
 * Reads the site's robots.txt and answers whether it permits us this path.
 *
 * Any failure — no robots.txt, a 500, a timeout — resolves to allowed. A site that
 * cannot tell us its rules has not told us no, and RFC 9309 says the same: an
 * unreachable robots.txt means unrestricted access for a request like this one.
 */
async function robotsAllows(url: string): Promise<boolean> {
  const target = new URL(url);
  try {
    const addresses = await resolvePublicAddresses(target.hostname);
    if (addresses.length === 0) return true;

    const response = await requestPinnedBody(
      new URL("/robots.txt", target.origin).toString(),
      addresses[0],
      { maxBytes: MAX_ROBOTS_BYTES, timeoutMs: ROBOTS_TIMEOUT_MS, accept: "text/plain,*/*" },
    );
    if (response.status !== 200 || !response.body) return true;

    return isPathAllowedByRobots(
      response.body,
      `${target.pathname}${target.search}`,
      IMPORT_USER_AGENT_TOKEN,
    );
  } catch {
    return true;
  }
}

const ROBOTS_REFUSAL = {
  status: "unreachable",
  message:
    "This website asks automated tools not to read that page, so nothing was imported. " +
    "You can still enter the details by hand.",
} as const;

/**
 * Production entry point: robots check, then one safety-checked GET.
 *
 * Robots is checked twice on purpose. Once for the address the CAM pasted, and again
 * if the redirects landed on a different site — the second site never agreed to the
 * first site's rules, and a redirect is exactly how a request ends up somewhere its
 * permission was never checked.
 */
export async function fetchImportPage(
  value: string | null | undefined,
): Promise<PageFetchResult> {
  const format = validateWebsiteFormat(value);
  if (format.status === "valid" && !(await robotsAllows(format.url))) {
    return { ...ROBOTS_REFUSAL, requestedUrl: format.url };
  }

  const result = await fetchPage(value, {
    resolve: resolvePublicAddresses,
    request: (url, address) =>
      requestPinnedBody(url, address, {
        maxBytes: MAX_PAGE_BYTES,
        timeoutMs: HTTP_TIMEOUT_MS,
        accept: "text/html,application/xhtml+xml",
      }),
    async onFailure(error, hostname) {
      await reportError(error, { operation: "clients.url_import_fetch", hostname });
    },
  });

  if (
    result.status === "fetched" &&
    new URL(result.finalUrl).origin !== new URL(result.requestedUrl).origin &&
    !(await robotsAllows(result.finalUrl))
  ) {
    return { ...ROBOTS_REFUSAL, requestedUrl: result.requestedUrl };
  }

  return result;
}
