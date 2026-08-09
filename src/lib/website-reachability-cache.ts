import { unstable_cache } from "next/cache";

import { checkWebsiteReachability } from "./website-reachability";

// This project has not enabled Next 16 Cache Components, so `use cache` is not
// available yet. Keep reachability results for an hour with the supported legacy
// cache instead of blocking every profile render on DNS/HTTP checks.
const cachedCheck = unstable_cache(
  checkWebsiteReachability,
  ["f046-website-reachability"],
  { revalidate: 60 * 60 },
);

export function checkWebsiteReachabilityCached(
  value: string | null | undefined,
) {
  return cachedCheck(value);
}
