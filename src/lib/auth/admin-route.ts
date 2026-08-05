/**
 * Where a refused request to an admin-only page is sent (F016/F017).
 *
 * Kept as a pure function, separate from the pages that call it, for the reason
 * `login.ts` is separate from its Server Action: a module importing
 * `next/navigation` cannot be loaded by `node --test`, and this decision — which
 * is the whole of the CAM/admin route boundary (F017 AC2) — is the part worth
 * testing. Each page keeps its own `redirect()`.
 *
 * Only `forbidden` means "a usable session that lacks this permission" — a CAM
 * or viewer who typed an admin URL. They go to `/dashboard`, which renders the
 * `admin-access-required` banner telling them why (AC: clear feedback when an
 * action is blocked).
 *
 * Every other reason means the session itself cannot be used: there is no user,
 * the account is not approved, it has been suspended, or its profile row is
 * missing. `/dashboard` refuses all four and would bounce them onward, so they
 * go straight to `/login` instead of through a redirect they never see.
 */

import type { PermissionFailureReason } from "./permissions.ts";

export const ADMIN_ACCESS_DENIED_PATH = "/dashboard?error=admin-access-required";

export function adminRouteDestination(reason: PermissionFailureReason): string {
  return reason === "forbidden" ? ADMIN_ACCESS_DENIED_PATH : "/login";
}
