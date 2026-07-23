import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// PLACEHOLDER VALUE — F007's ticket has an open question on the actual
// timeout policy ("Session timeout policy"). Using 30 minutes as a
// reasonable default until that decision is made. Flag for review.
const INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const ACTIVITY_COOKIE_NAME = "last_activity";

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

    if (lastActivity && now - lastActivity > INACTIVITY_TIMEOUT_MS) {
      // Too much idle time has passed. Sign out server-side so the
      // token is genuinely invalidated, not just ignored client-side —
      // satisfies "cannot be reused even if replayed."
      await supabase.auth.signOut();

      const expiredUrl = new URL("/login", request.url);
      expiredUrl.searchParams.set("reason", "expired");
      const expiredResponse = NextResponse.redirect(expiredUrl);

      // Clear the activity cookie too, so a stale timestamp doesn't
      // linger after the session ends.
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
