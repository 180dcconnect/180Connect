import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import {
  ACTIVITY_COOKIE_NAME,
  INACTIVITY_TIMEOUT_MS,
  isSessionExpired,
} from "./session-expiry";
import { logSecurityEvent } from "@/lib/log-security-event";
import { reportError } from "@/lib/error-logging";
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
  const { data: { user } } = await supabase.auth.getUser();

  // Only check inactivity if there's actually a logged-in user.
  // Logged-out visitors have nothing to expire.
  if (user) {
    const lastActivityCookie = request.cookies.get(ACTIVITY_COOKIE_NAME);
    const lastActivity = lastActivityCookie
      ? parseInt(lastActivityCookie.value, 10)
      : null;
    const now = Date.now();

    if (isSessionExpired(lastActivity, now, INACTIVITY_TIMEOUT_MS)) {
      // Too much idle time has passed. Sign out server-side so the
      // token is genuinely invalidated, not just ignored client-side —
      // satisfies "cannot be reused even if replayed."
      const { error } = await supabase.auth.signOut();

      // Log the expiry event per F007 + codebase convention (F222's
      // logSecurityEvent, same pattern used for other auth failures).
      // NOTE: "authentication.login_failed" is the closest existing
      // SecurityEvent type — none of the three current options exactly
      // describe a session timing out. Flagging for review; may warrant
      // its own event type (e.g. "session.expired") in a future PR.
      logSecurityEvent("authentication.login_failed", {
        reason: "session_expired",
        userId: user.id,
      });

      if (error) {
        await reportError(error, { component: "session-expiry" });
      }

      const expiredUrl = new URL("/login", request.url);
      expiredUrl.searchParams.set("reason", "expired");
      const expiredResponse = NextResponse.redirect(expiredUrl);

      expiredResponse.cookies.delete(ACTIVITY_COOKIE_NAME);
      return expiredResponse;
    }

    // Still active — refresh the "last activity" timestamp on every
    // request, so the timeout resets while the user keeps using the app.
    response.cookies.set(ACTIVITY_COOKIE_NAME, now.toString(), {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
    });
  }

  return response;
}