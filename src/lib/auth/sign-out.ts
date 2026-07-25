/**
 * Sign-out with failure reporting (F006).
 *
 * Supabase signals a failed sign-out by *returning* `{ error }`, not by
 * throwing, so an unchecked `await supabase.auth.signOut()` swallows the
 * failure silently. This wrapper inspects the result and reports it through
 * `reportError`, which gives the failure a durable, scrubbed record in the
 * platform logs (and in Sentry when a DSN is configured).
 *
 * The caller redirects to /login either way. A user who pressed "log out" must
 * never be left sitting on an authenticated page, and the session cookie is
 * cleared locally regardless of what the server said.
 */

import { reportError } from "../error-logging.ts";

/** The slice of the Supabase client this module needs — enough to fake in tests. */
export type SignOutClient = {
  auth: {
    signOut: () => Promise<{ error: { message: string } | null }>;
  };
};

/**
 * Signs the user out and reports any failure. Never throws: a logout that
 * crashes is strictly worse than one that failed quietly, because the caller
 * would then skip the redirect too.
 *
 * @returns `true` when Supabase confirmed the sign-out, `false` otherwise.
 */
export async function signOutAndReport(client: SignOutClient): Promise<boolean> {
  try {
    const { error } = await client.auth.signOut();
    if (!error) return true;

    // Supabase's AuthError is an Error, but a plain `{ message }` would be
    // stringified to "[object Object]" by the reporter — wrap it so the
    // message always survives.
    const reported = error instanceof Error ? error : new Error(error.message);
    await reportError(reported, { component: "auth", errorType: "logout_failed" });
    return false;
  } catch (thrown) {
    // Network failure, or a client that rejected instead of returning an error.
    await reportError(thrown, { component: "auth", errorType: "logout_failed" });
    return false;
  }
}
