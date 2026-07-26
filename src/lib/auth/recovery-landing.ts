import "server-only";

import { NextResponse, type NextRequest } from "next/server";
import type { User } from "@supabase/supabase-js";

import { logAuthApiHealth, logAuthError } from "./observability";
import {
  RECOVERY_COOKIE_NAME,
  RESET_LINK_ERROR,
  recoveryCookieOptions,
  signRecoveryMarker,
} from "./password-reset";

/**
 * The half of the two recovery landing routes that is identical between them
 * (F004).
 *
 * There are two because Supabase can deliver a recovery link in two shapes, and
 * which one arrives depends on the email template configured in the dashboard:
 * `/auth/confirm` takes a `token_hash` (works in any browser, since nothing is
 * held client-side) and `/auth/recovery` takes a PKCE `code` (only works in the
 * browser that asked for the reset). Both end the same way — verify, mark the
 * session as mid-recovery, land on the reset form — so that ending lives here.
 */

/** Sends the user to the reset page with the generic link failure showing. */
export function invalidLinkResponse(request: NextRequest) {
  const url = new URL("/reset-password", request.url);
  url.searchParams.set("error", RESET_LINK_ERROR);
  return NextResponse.redirect(url);
}

type VerifyResult = {
  data: { user: User | null };
  error: { code?: string; message: string } | null;
};

/**
 * Runs `verify`, and on success returns a redirect to the reset form carrying
 * the signed recovery marker.
 *
 * The marker is what `src/lib/supabase/session-guard.ts` reads to keep the
 * session Supabase just minted confined to the reset flow — see
 * `password-reset.ts` for why that matters.
 *
 * @param operation - the API_HEALTH_LOGS label for this link shape.
 */
export async function completeRecoveryLanding(
  request: NextRequest,
  operation: string,
  verify: () => Promise<VerifyResult>,
) {
  const startedAt = Date.now();

  try {
    const { data, error } = await verify();
    logAuthApiHealth(operation, !error, startedAt, { error_code: error?.code });

    if (error || !data.user) {
      logAuthError(
        "authentication.password_recovery_link_rejected",
        error ?? new Error("no user returned"),
        { error_code: error?.code },
      );
      return invalidLinkResponse(request);
    }

    const response = NextResponse.redirect(new URL("/reset-password", request.url));
    response.cookies.set(
      RECOVERY_COOKIE_NAME,
      await signRecoveryMarker(data.user.id),
      recoveryCookieOptions(),
    );
    return response;
  } catch (error) {
    logAuthApiHealth(operation, false, startedAt);
    logAuthError("authentication.password_recovery_link_rejected", error);
    return invalidLinkResponse(request);
  }
}
