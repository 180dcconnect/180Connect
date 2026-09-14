import { unstable_cache } from "next/cache";

import { checkWebsiteReachability } from "./website-reachability";

// This project has not enabled Next 16 Cache Components, so `use cache` is not
// available yet. Keep reachability results for an hour with the supported legacy
// cache instead of blocking every profile render on DNS/HTTP checks.
const cachedCheck = unstable_cache(
  checkWebsiteReachability,
  // Bumped to -v3 when HEAD 405/501 started falling back to GET: the key is the
  // only thing that invalidates this cache, so without a bump every record
  // already checked as "unreachable" on a HEAD-refusing host would serve its
  // stale verdict for up to an hour. (v2 was the scheme-less-hosts bump.)
  ["f046-website-reachability-v3"],
  { revalidate: 60 * 60, tags: ["website-reachability"] },
);

export function checkWebsiteReachabilityCached(
  value: string | null | undefined,
) {
  return cachedCheck(value);
}
