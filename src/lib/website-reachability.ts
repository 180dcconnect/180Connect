import { resolve4, resolve6 } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";

import { reportError } from "./error-logging.ts";
import { checkWebsite, isPrivateAddress, type WebsiteStatus } from "./website-validation.ts";

const DNS_TIMEOUT_MS = 3_000;
const HTTP_TIMEOUT_MS = 5_000;

async function within<T>(promise: Promise<T>, milliseconds: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(message)), milliseconds);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Exported for src/lib/import/page-transport.ts (F037), which needs exactly this
 * check before it opens a socket. Two copies of a DNS-safety rule is one copy too
 * many: a fix applied to one and not the other is a hole nobody would notice.
 */
export async function resolvePublicAddresses(hostname: string): Promise<readonly string[]> {
  const literal = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (isIP(literal)) {
    // isUnsafeHostname in website-validation.ts already rejects private IP literals at
    // format-check time. Guard here as well so this function is safe when called in
    // isolation (tests, future callers) without the format check as a prerequisite.
    if (isPrivateAddress(literal)) return [];
    return [literal];
  }

  const [ipv4, ipv6] = await within(
    Promise.all([resolve4(literal).catch(() => []), resolve6(literal).catch(() => [])]),
    DNS_TIMEOUT_MS,
    "Website DNS lookup timed out",
  );
  return [...ipv4, ...ipv6].filter((address) => !isPrivateAddress(address));
}

type LookupCallback = (
  error: NodeJS.ErrnoException | null,
  address: string | { address: string; family: number }[],
  family?: number,
) => void;

/**
 * A `lookup` that resolves to one already-validated address, in both the shapes Node
 * asks for it.
 *
 * Node calls `lookup` two different ways. With `autoSelectFamily` on — the default
 * since Node 20 — it passes `{ all: true }` and expects an array of candidates;
 * otherwise it expects `(err, address, family)`. Answering only the second shape makes
 * every connection fail with "Invalid IP address: undefined", which surfaces as the
 * site being unreachable rather than as our own bug. Confirmed live on 2026-08-17:
 * checkWebsiteReachability("https://www.bhf.org.uk") returned `unreachable` for a site
 * that was up, and had been doing so for every site since the Node 24 upgrade.
 *
 * Exported so F037's page fetch (src/lib/import/page-transport.ts) pins the same way.
 * Two copies of this would be two chances to get the callback contract wrong.
 */
export function pinnedLookup(address: string, family: 4 | 6) {
  return (
    _hostname: string,
    optionsOrCallback: { all?: boolean } | LookupCallback,
    maybeCallback?: LookupCallback,
  ) => {
    const callback =
      typeof optionsOrCallback === "function" ? optionsOrCallback : maybeCallback;
    const options =
      typeof optionsOrCallback === "object" ? optionsOrCallback : undefined;

    if (typeof callback !== "function") return;

    if (options?.all) {
      callback(null, [{ address, family }]);
    } else {
      callback(null, address, family);
    }
  };
}

/**
 * Native HTTP transport with a custom lookup that returns only the validated IP.
 * The URL hostname remains intact for the Host header and TLS SNI/certificate check,
 * while the TCP connection cannot be redirected by a second DNS answer.
 */
async function requestPinned(url: string, address: string) {
  const target = new URL(url);
  const family = isIP(address);
  if (family !== 4 && family !== 6) throw new Error("Resolved address is not an IP");

  return new Promise<{ status: number; location: string | null }>((resolve, reject) => {
    const request = (target.protocol === "https:" ? httpsRequest : httpRequest)(
      target,
      {
        method: "HEAD",
        headers: { Host: target.host, "User-Agent": "180Connect-Website-Validator/1.0" },
        lookup: pinnedLookup(address, family),
      },
      (response) => {
        response.resume();
        resolve({
          status: response.statusCode ?? 0,
          location: typeof response.headers.location === "string" ? response.headers.location : null,
        });
      },
    );

    request.setTimeout(HTTP_TIMEOUT_MS, () => {
      request.destroy(new Error("Website request timed out"));
    });
    request.on("error", reject);
    request.end();
  });
}

/** Production wrapper; decision logic stays injectable and unit-testable. */
export function checkWebsiteReachability(
  value: string | null | undefined,
): Promise<WebsiteStatus> {
  return checkWebsite(value, {
    resolve: resolvePublicAddresses,
    request: requestPinned,
    async onFailure(error, hostname) {
      await reportError(error, {
        operation: "clients.website_validation",
        hostname,
      });
    },
  });
}
