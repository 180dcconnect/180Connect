import { resolve4, resolve6 } from "node:dns/promises";

import { checkWebsite, type WebsiteStatus } from "./website-validation.ts";

async function resolvePublicAddresses(hostname: string): Promise<readonly string[]> {
  const [ipv4, ipv6] = await Promise.all([
    resolve4(hostname).catch(() => []),
    resolve6(hostname).catch(() => []),
  ]);
  return [...ipv4, ...ipv6];
}

/** Production dependency wrapper; decision logic stays injectable and unit-testable. */
export function checkWebsiteReachability(
  value: string | null | undefined,
): Promise<WebsiteStatus> {
  return checkWebsite(value, { resolve: resolvePublicAddresses, fetch });
}
