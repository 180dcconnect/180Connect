import { resolve4, resolve6 } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";

import { reportError } from "./error-logging.ts";
import { checkWebsite, type WebsiteStatus } from "./website-validation.ts";

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

async function resolvePublicAddresses(hostname: string): Promise<readonly string[]> {
  const literal = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (isIP(literal)) return [literal];

  const [ipv4, ipv6] = await within(
    Promise.all([resolve4(literal).catch(() => []), resolve6(literal).catch(() => [])]),
    DNS_TIMEOUT_MS,
    "Website DNS lookup timed out",
  );
  return [...ipv4, ...ipv6];
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
        lookup: (_hostname, _options, callback) => callback(null, address, family),
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
