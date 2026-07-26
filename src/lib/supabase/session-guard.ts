/**
 * The decision half of session expiry (F007).
 *
 * `src/lib/supabase/proxy.ts` cannot be unit-tested: it imports `next/server`,
 * which only resolves inside the bundler. So everything that decides *what*
 * should happen to a request lives here, behind plain structural types, and the
 * proxy is left with the plumbing that carries the decision out.
 *
 * That split is deliberate — every bug found in the first review of this
 * feature was a decision bug (expiry failing open, a session reviving itself
 * after the redirect, prefetches renewing the window), and none of them were
 * reachable by a test while they lived inside the proxy.
 */

// Relative, extension-qualified imports: this module is unit-tested by
// `node --test`, which resolves neither the `@/` alias nor bare .ts specifiers.
// Same convention as `src/lib/auth/sign-out.ts`.
import {
  isRecoveryAllowedPath,
  readRecoveryMarker,
  RECOVERY_COOKIE_NAME,
} from "../auth/password-reset.ts";
import { signOutAndReport, type SignOutClient } from "../auth/sign-out.ts";
import { SESSION_EXPIRED } from "../auth/signed-out-notice.ts";
import { logSecurityEvent } from "../log-security-event.ts";
import {
  ACTIVITY_COOKIE_NAME,
  activityCookieOptions,
  activitySecret,
  isSessionExpired,
  readActivity,
  signActivity,
  type ActivityCookieOptions,
} from "./session-expiry.ts";

/** The slice of `NextRequest` this module reads — enough to fake in tests. */
export type GuardRequest = {
  pathname: string;
  headers: { get(name: string): string | null };
  cookies: { get(name: string): { value: string } | undefined };
};

/** The slice of the Supabase client this module needs. */
export type GuardClient = SignOutClient & {
  auth: {
    getUser: () => Promise<{ data: { user: { id: string } | null } }>;
  };
};

/** What the proxy should do with the request. */
export type GuardOutcome =
  | {
      action: "pass";
      /** Why nothing was done — surfaced for tests and future logging. */
      reason: "signed-out" | "auth-route" | "background" | "recovery";
    }
  | {
      action: "confine";
      /** Relative URL a mid-recovery session is held at. */
      redirectTo: string;
    }
  | {
      action: "refresh";
      cookie: { name: string; value: string; options: ActivityCookieOptions };
    }
  | {
      action: "expire";
      /** Relative URL to send the user to, notice marker included. */
      redirectTo: string;
      /** Whether Supabase confirmed the sign-out. */
      signedOut: boolean;
    };

/**
 * Requests that must not renew the inactivity window.
 *
 * A page left open in a background tab still talks to the server: it prefetches
 * links and refetches route payloads on its own. Counting those as "activity"
 * would mean an abandoned laptop never times out, so only requests the user
 * actually caused keep a session alive. Such requests can still *expire* a
 * session — a stale window is stale no matter who noticed.
 *
 * Caveat, measured against Next 16.2 rather than assumed: the framework strips
 * its own `RSC` and `Next-Router-Prefetch` headers before proxy code runs, so
 * only the client-set ones below are actually observable here. `Sec-Purpose` is
 * the standardised header modern browsers send; `Purpose`/`X-Purpose` are the
 * older spellings. A `<Link>` prefetch that arrives with none of them still
 * renews the window — the alternative, treating every RSC request as
 * background, would stop renewing while someone is actively clicking around,
 * and a session that expires under a working user is the worse failure.
 */
export function isBackgroundRequest(request: GuardRequest): boolean {
  const secPurpose = request.headers.get("sec-purpose") ?? "";
  return (
    secPurpose.includes("prefetch") ||
    request.headers.get("purpose") === "prefetch" ||
    request.headers.get("x-purpose") === "preview" ||
    // Stripped by Next 16 before it reaches us, but harmless to keep for
    // runtimes that do forward it.
    request.headers.get("next-router-prefetch") === "1"
  );
}

/** /login is where expiry sends people; expiring them again would loop. */
function isAuthRoute(request: GuardRequest): boolean {
  return request.pathname.startsWith("/login");
}

/**
 * Decides how the request should be treated, signing the user out when their
 * idle window has closed.
 *
 * @param now - injectable so tests need not wait out a real timeout.
 */
export async function decideSessionAction(
  request: GuardRequest,
  client: GuardClient,
  now: number = Date.now(),
): Promise<GuardOutcome> {
  const {
    data: { user },
  } = await client.auth.getUser();

  // Nothing to expire for a logged-out visitor, and /login must stay reachable.
  if (!user) return { action: "pass", reason: "signed-out" };

  // A session that arrived through a password-reset link (F004) is handled
  // before anything else, because it is not an ordinary signed-in session and
  // both of the branches below get it wrong.
  //
  // It must not reach the app: verifying a recovery link necessarily mints a
  // real session — the only way `updateUser` can set a password — so without
  // this, clicking the emailed link and then navigating to /dashboard is a way
  // in with no password and no CAPTCHA. It confines rather than expires.
  //
  // Nor can it be left to the inactivity rules: a recovery session never passed
  // through the login action, so it has no activity record, and expiry fails
  // closed. It would be signed out on its very first request and the reset
  // could never complete. Its lifetime is bounded by the marker cookie and by
  // the Supabase link expiry instead.
  const recoveryUserId = await readRecoveryMarker(
    request.cookies.get(RECOVERY_COOKIE_NAME)?.value,
  );
  if (recoveryUserId !== null && recoveryUserId === user.id) {
    if (isRecoveryAllowedPath(request.pathname)) {
      return { action: "pass", reason: "recovery" };
    }
    logSecurityEvent("session.recovery_confined", {
      userId: user.id,
      pathname: request.pathname,
    });
    return { action: "confine", redirectTo: "/reset-password" };
  }

  if (isAuthRoute(request)) return { action: "pass", reason: "auth-route" };

  const secret = activitySecret();
  const lastActivity = await readActivity(
    request.cookies.get(ACTIVITY_COOKIE_NAME)?.value,
    secret,
  );

  if (isSessionExpired(lastActivity, now)) {
    // Sign out server-side so the refresh token is genuinely revoked rather
    // than merely ignored here — a session left alive on the Supabase side can
    // still be replayed. `signOutAndReport` (F006) gives a failed sign-out a
    // durable record and never throws, so expiry always proceeds.
    const signedOut = await signOutAndReport(client);

    logSecurityEvent("session.expired", {
      userId: user.id,
      hadActivityRecord: lastActivity !== null,
      idleMs: lastActivity === null ? undefined : now - lastActivity,
      signedOut,
    });

    return {
      action: "expire",
      redirectTo: `/login?signed_out=${SESSION_EXPIRED}`,
      signedOut,
    };
  }

  if (isBackgroundRequest(request)) return { action: "pass", reason: "background" };

  return {
    action: "refresh",
    cookie: {
      name: ACTIVITY_COOKIE_NAME,
      value: await signActivity(now, secret),
      options: activityCookieOptions(),
    },
  };
}

/**
 * A response whose cookies can be read and written — `NextResponse`, in
 * practice. `Cookie` is inferred from `getAll`, so the real `ResponseCookie`
 * shape flows through without this module importing `next/server`.
 */
export type ResponseCookieLike = { name: string; value: string };

export type CookieBearer = {
  cookies: {
    getAll(): ResponseCookieLike[];
    /** Method syntax on purpose: it is what makes `NextResponse` assignable here. */
    set(cookie: ResponseCookieLike): unknown;
    delete(name: string): unknown;
  };
};

/**
 * Moves the cookies Supabase wrote during sign-out onto the redirect response.
 *
 * Without this the redirect is a fresh response carrying none of them, so the
 * browser keeps its auth cookies: the session survives the sign-out, and with
 * the activity record gone the next request reads as a brand-new one. The
 * activity cookie is dropped rather than copied — an expired session has no
 * window left to record.
 */
export function carryCookiesToRedirect(from: CookieBearer, to: CookieBearer): void {
  for (const cookie of from.cookies.getAll()) {
    to.cookies.set(cookie);
  }
  to.cookies.delete(ACTIVITY_COOKIE_NAME);
}
