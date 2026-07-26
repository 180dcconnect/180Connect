import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { signOutAndReport } from "@/lib/auth/sign-out";
import { SESSION_EXPIRED } from "@/lib/auth/signed-out-notice";
import { logSecurityEvent } from "@/lib/log-security-event";
import {
  ACTIVITY_COOKIE_NAME,
  activityCookieOptions,
  activitySecret,
  isSessionExpired,
  readActivity,
  signActivity,
} from "./session-expiry";

/**
 * Requests that must not renew the inactivity window (F007).
 *
 * A page left open in a background tab still talks to the server: Next
 * prefetches links and refetches route payloads on its own. Counting those as
 * "activity" would mean an abandoned laptop never times out, so only requests
 * the user actually caused keep a session alive.
 */
function isBackgroundRequest(request: NextRequest): boolean {
  const headers = request.headers;
  return (
    headers.get("next-router-prefetch") === "1" ||
    headers.get("purpose") === "prefetch" ||
    headers.get("x-purpose") === "preview"
  );
}

/** /login is where expiry sends people; expiring them again would loop. */
function isAuthRoute(request: NextRequest): boolean {
  return request.nextUrl.pathname.startsWith("/login");
}

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) return response;

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value),
        );
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  // getUser verifies the token with Supabase and refreshes it when necessary.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Nothing to expire for a logged-out visitor, and /login must stay reachable.
  if (!user || isAuthRoute(request)) return response;

  const secret = activitySecret();
  const lastActivity = await readActivity(
    request.cookies.get(ACTIVITY_COOKIE_NAME)?.value,
    secret,
  );
  const now = Date.now();

  if (isSessionExpired(lastActivity, now)) {
    // Sign out server-side so the refresh token is genuinely revoked rather
    // than merely ignored here — a session left alive on the Supabase side can
    // still be replayed. `signOutAndReport` (F006) gives a failed sign-out a
    // durable record and never throws, so the redirect below always happens.
    await signOutAndReport(supabase);

    logSecurityEvent("session.expired", {
      userId: user.id,
      hadActivityRecord: lastActivity !== null,
      idleMs: lastActivity === null ? undefined : now - lastActivity,
    });

    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("signed_out", SESSION_EXPIRED);
    const expiredResponse = NextResponse.redirect(loginUrl);

    // `signOut` cleared the Supabase auth cookies on `response`, which this
    // redirect replaces. Copying them across is what actually removes the
    // session from the browser — without it the cookies survive the redirect
    // and the very next request looks signed in again.
    for (const cookie of response.cookies.getAll()) {
      expiredResponse.cookies.set(cookie);
    }
    expiredResponse.cookies.delete(ACTIVITY_COOKIE_NAME);

    return expiredResponse;
  }

  // Still active: push the idle window out. Background traffic is excluded so
  // the window tracks the user, not the framework.
  if (!isBackgroundRequest(request)) {
    response.cookies.set(
      ACTIVITY_COOKIE_NAME,
      await signActivity(now, secret),
      activityCookieOptions(),
    );
  }

  return response;
}
