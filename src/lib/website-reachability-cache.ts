import { unstable_cache } from "next/cache";

import { checkWebsiteReachability } from "./website-reachability";

// This project has not enabled Next 16 Cache Components, so `use cache` is not
// available yet. Keep reachability results for an hour with the supported legacy
// cache instead of blocking every profile render on DNS/HTTP checks.
const cachedCheck = unstable_cache(
  checkWebsiteReachability,
  // Bumped to -v2 when scheme-less hosts started validating: the key is the only
  // thing that invalidates this cache, so without a bump every record already
  // checked would serve its stale "invalid format" verdict for up to an hour.
  ["f046-website-reachability-v2"],
  { revalidate: 60 * 60 },
);

export function checkWebsiteReachabilityCached(
  value: string | null | undefined,
) {
  return cachedCheck(value);
}
