import "server-only";

import { NextResponse, type NextRequest } from "next/server";
import type { User } from "@supabase/supabase-js";

import { INVITE_LINK_ERROR } from "./invite";
import { logAuthApiHealth, logAuthError } from "./observability";
import {
  RECOVERY_COOKIE_NAME,
  RESET_LINK_ERROR,
  recoveryCookieOptions,
  signRecoveryMarker,
} from "./password-reset";

/**
 * The half of the two recovery landing routes that is identical between them
 * (F004), now shared with the invite-acceptance link (F008, F010).
 *
 * There are two because Supabase can deliver a recovery link in two shapes, and
 * which one arrives depends on the email template configured in the dashboard:
 * `/auth/confirm` takes a `token_hash` (works in any browser, since nothing is
 * held client-side) and `/auth/recovery` takes a PKCE `code` (only works in the
 * browser that asked for the reset — recovery only, no invite email uses this
 * shape). Both end the same way — verify, mark the session as mid-recovery,
 * land on the reset form — so that ending lives here.
 *
 * `linkKind` exists only to pick the right wording: an invite link and a
 * password-reset link fail for a caller in the same way (Supabase rejects an
 * expired or reused token — the same shared `otp_expiry`, see
 * `invite-expiry.ts`), but "request a new link" is correct advice for one and a
 * dead end for the other — an invited person cannot send themselves a second
 * invite. It carries no security weight; the marker cookie below is what
 * actually gates the session.
 */
export type LinkKind = "recovery" | "invite";

/** Sends the user to the reset page with the link failure showing, worded for `linkKind`. */
export function invalidLinkResponse(request: NextRequest, linkKind: LinkKind = "recovery") {
  const url = new URL("/reset-password", request.url);
  url.searchParams.set("error", linkKind === "invite" ? INVITE_LINK_ERROR : RESET_LINK_ERROR);
  url.searchParams.set("flow", linkKind);
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
 * The redirect also carries the verified email in the query string, so
 * `/reset-password` can show it back to the person confirming their own
 * account (F009 AC1) without a second round trip to Supabase to fetch it. This
 * is not new exposure — `email` is the value Supabase's own verification just
 * confirmed belongs to the browser making this request, the same trust level
 * the login form already gives back to whoever types an address into it.
 *
 * @param operation - the API_HEALTH_LOGS label for this link shape.
 * @param linkKind - which flow this link belongs to, for wording only.
 */
export async function completeRecoveryLanding(
  request: NextRequest,
  operation: string,
  linkKind: LinkKind,
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
      return invalidLinkResponse(request, linkKind);
    }

    const url = new URL("/reset-password", request.url);
    url.searchParams.set("flow", linkKind);
    if (data.user.email) url.searchParams.set("email", data.user.email);

    const response = NextResponse.redirect(url);
    response.cookies.set(
      RECOVERY_COOKIE_NAME,
      await signRecoveryMarker(data.user.id),
      recoveryCookieOptions(),
    );
    return response;
  } catch (error) {
    logAuthApiHealth(operation, false, startedAt);
    logAuthError("authentication.password_recovery_link_rejected", error);
    return invalidLinkResponse(request, linkKind);
  }
}
