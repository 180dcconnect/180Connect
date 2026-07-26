import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { carryCookiesToRedirect, decideSessionAction } from "./session-guard";

/**
 * Refreshes the Supabase session on every request, and enforces the F007
 * inactivity timeout.
 *
 * The decisions live in `./session-guard` — this file only carries them out,
 * because `next/server` cannot be imported by the test runner.
 */
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

  // The guard calls getUser — which verifies the token with Supabase and
  // refreshes it when necessary — then decides what the session has earned.
  const outcome = await decideSessionAction(
    {
      pathname: request.nextUrl.pathname,
      headers: request.headers,
      cookies: { get: (name) => request.cookies.get(name) },
    },
    supabase,
  );

  if (outcome.action === "refresh") {
    const { name, value, options } = outcome.cookie;
    response.cookies.set(name, value, options);
    return response;
  }

  // A mid-recovery session is held at the reset page rather than signed out —
  // signing it out would make completing the reset impossible. The redirect
  // carries `response`'s cookies so any token Supabase refreshed above survives.
  if (outcome.action === "confine") {
    const confinedResponse = NextResponse.redirect(
      new URL(outcome.redirectTo, request.url),
    );
    for (const cookie of response.cookies.getAll()) {
      confinedResponse.cookies.set(cookie);
    }
    return confinedResponse;
  }

  if (outcome.action === "expire") {
    const expiredResponse = NextResponse.redirect(
      new URL(outcome.redirectTo, request.url),
    );
    // `response` holds the cookie deletions Supabase made while signing out.
    // Carrying them across is what actually removes the session from the
    // browser — see `carryCookiesToRedirect`.
    carryCookiesToRedirect(response, expiredResponse);
    return expiredResponse;
  }

  return response;
}
