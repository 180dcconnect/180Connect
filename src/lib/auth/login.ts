/**
 * The login decision (F001), separated from the Server Action that calls it.
 *
 * `src/app/login/actions.ts` cannot be imported by a test: `"use server"` and
 * `next/navigation`'s `redirect` only work inside a request. So the part worth
 * testing — domain restriction, the deliberately vague credentials message,
 * the suspended-account branch — lives here behind an injectable client, the
 * same shape `signOutAndReport` uses. The action keeps only the Supabase
 * client construction and the redirect.
 */

import type { User } from "@supabase/supabase-js";
import { z } from "zod";

import { logSecurityEvent } from "../log-security-event.ts";
import { emailField, safeValidate } from "../validation.ts";
import { NO_THROTTLE, throttleMessage, type LoginThrottle } from "./login-throttle.ts";

/** Used when AUTH_ALLOWED_EMAIL_DOMAIN is unset. */
export const DEFAULT_ALLOWED_EMAIL_DOMAIN = "180dc.org";

/**
 * One domain, or several — a comma-separated list is accepted wherever a single
 * domain used to be, so an existing caller passing `"180dc.org"` is unaffected.
 */
export type DomainRule = string | readonly string[];

/**
 * The domains users may sign in from, as bare domains. Read per call rather than
 * at module load so a test (or a restarted server) sees the current value.
 *
 * **This is the friendly half of a two-layer rule, not the rule itself.** The
 * enforcement lives in Postgres: `public.check_allowed_email_domain()` fires
 * before every `auth.users` insert and reads `app.allowed_email_domains`
 * (20260804160000). This exists so someone typing the wrong address gets a
 * sentence instead of a database error — and so an environment permitting an
 * extra domain for testing does not have its own login form refuse it.
 *
 * The two must be kept in step by hand, one row and one environment variable.
 * A mismatch is not dangerous in either direction, which is why it is acceptable:
 * narrower here means a clear message from the form; wider here means Postgres
 * refuses, which is the layer that decides. Widening this alone can never let
 * anybody in.
 */
export function allowedEmailDomains(
  env: Record<string, string | undefined> = process.env,
): string[] {
  const configured = (env.AUTH_ALLOWED_EMAIL_DOMAIN ?? DEFAULT_ALLOWED_EMAIL_DOMAIN)
    .split(",")
    .map((domain) => domain.trim().toLowerCase().replace(/^@/, ""))
    .filter((domain) => domain !== "");

  // An empty or comma-only value falls back rather than permitting nothing: a
  // login form that refuses every address is a worse failure than one that is
  // briefly too strict, and Postgres is still the layer that decides.
  return configured.length > 0 ? configured : [DEFAULT_ALLOWED_EMAIL_DOMAIN];
}

/**
 * The first configured domain. For copy that has to name one — a placeholder, a
 * hint — where listing all of them would read badly.
 */
export function allowedEmailDomain(
  env: Record<string, string | undefined> = process.env,
): string {
  return allowedEmailDomains(env)[0];
}

/** Normalises either accepted shape into a list. */
export function toDomainList(rule: DomainRule): string[] {
  return typeof rule === "string" ? [rule] : [...rule];
}

/**
 * Whether `email` sits on one of `domains`.
 *
 * Requires exactly one `@`, and compares the whole domain rather than matching a
 * suffix. Both matter. The old check was `email.endsWith('@180dc.org')`, which
 * accepts `attacker@evil.com@180dc.org` — and so does any implementation that
 * simply reads what follows the *last* `@`. An address with two of them is
 * malformed; it is not an address on the second domain.
 *
 * The same rule is enforced in Postgres by `public.check_allowed_email_domain()`
 * (20260804160000), and the two are meant to agree exactly.
 */
export function isOnAllowedDomain(email: string, domains: readonly string[]): boolean {
  const parts = email.trim().toLowerCase().split("@");
  if (parts.length !== 2) return false;

  const [localPart, domain] = parts;
  if (localPart === "" || domain === "") return false;

  return domains.includes(domain);
}

/** "@180dc.org" for one, "@180dc.org or @example.com" for several. */
export function describeDomains(domains: readonly string[]): string {
  const listed = domains.map((domain) => `@${domain}`);
  if (listed.length === 1) return listed[0];
  return `${listed.slice(0, -1).join(", ")} or ${listed[listed.length - 1]}`;
}

/** Trims and lowercases a submitted email so echo-back and lookup agree. */
export function normalizeEmail(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

export function loginSchema(rule: DomainRule = allowedEmailDomains()) {
  const domains = toDomainList(rule);
  return z.object({
    email: emailField("Enter a valid email address.").refine(
      (email) => isOnAllowedDomain(email, domains),
      { message: `Use your ${describeDomains(domains)} email address.` },
    ),
    password: z.string().min(1, "Enter your password.").max(256),
  });
}

export type LoginState = {
  status: "idle" | "error" | "pending";
  message?: string;
  fieldErrors?: { email?: string[]; password?: string[] };
  email?: string;
};

/** The slice of the Supabase client this module needs — enough to fake in tests. */
export type LoginClient = {
  auth: {
    signInWithPassword: (credentials: {
      email: string;
      password: string;
      options?: { captchaToken?: string };
    }) => Promise<{ data: { user: User | null }; error: { message: string } | null }>;
    signOut: () => Promise<unknown>;
  };
};

/**
 * Reads `users.is_active` for the account that just signed in (F013).
 *
 * Separate from `LoginClient` and separately injectable because it cannot use the
 * signed-in client: `users_select_active` gates SELECT on `app.is_active_user()`, so
 * a suspended user querying their own row gets zero rows back — indistinguishable
 * from a missing profile. The caller passes a reader that bypasses RLS.
 *
 * `null` means "could not tell". Login is allowed to continue in that case: the
 * dashboard's own `getCurrentActor` gate still refuses a suspended account, so a
 * lookup failure costs a worse error message, not access.
 */
export type ActiveStatusReader = (userId: string) => Promise<boolean | null>;

export type LoginInput = {
  email: unknown;
  password: unknown;
  captchaToken: unknown;
};

/**
 * `ok` means the caller should redirect to the dashboard. Every other path
 * carries the state to re-render the form with.
 */
export type LoginOutcome = { ok: true } | { ok: false; state: LoginState };

/**
 * Message shown when Supabase itself is unreachable. Deliberately says nothing
 * about the cause — that goes to the logs, not to the browser.
 */
export const SERVICE_UNAVAILABLE_MESSAGE =
  "Login is temporarily unavailable. Please try again later.";

/**
 * Shown to a suspended account (F013 AC2). Deliberately explicit rather than
 * "invalid email or password": the person is a real team member holding correct
 * credentials, and a vague error sends them to reset a password that works fine.
 * It reveals nothing to an attacker who does not already hold those credentials —
 * it is only ever reached after `signInWithPassword` has succeeded.
 */
export const SUSPENDED_MESSAGE =
  "Your account has been suspended. Contact your administrator.";

/**
 * Validates the submission, checks the CAPTCHA was solved, checks the account is
 * not throttled, signs in, confirms the account is approved, and turns away a
 * suspended one. Never throws: a transport failure comes back as
 * `SERVICE_UNAVAILABLE_MESSAGE` so the action can render it.
 *
 * `throttle` defaults to the no-op so the twenty-odd tests that predate it read
 * unchanged; the Server Action always passes a real one. `readActiveStatus` is
 * optional for the same reason, and omitting it skips the suspension check rather
 * than failing it — `getCurrentActor` refuses a suspended account on the very next
 * request regardless, so the reader buys a better error message, not the security.
 */
export async function attemptLogin(
  client: LoginClient,
  input: LoginInput,
  rule: DomainRule = allowedEmailDomains(),
  throttle: LoginThrottle = NO_THROTTLE,
  readActiveStatus?: ActiveStatusReader,
): Promise<LoginOutcome> {
  const email = normalizeEmail(input.email);
  const result = safeValidate(loginSchema(rule), { email, password: input.password });

  if (!result.success) {
    logSecurityEvent("validation.rejected", {
      form: "login",
      fields: Object.keys(result.fieldErrors).join(","),
    });
    return {
      ok: false,
      state: {
        status: "error",
        message: "Check the highlighted fields and try again.",
        fieldErrors: result.fieldErrors,
        email,
      },
    };
  }

  const captchaToken = String(input.captchaToken ?? "");
  if (!captchaToken) {
    // The widget has not finished, or the user submitted before it ran. Saying
    // so beats a round trip that comes back as "invalid email or password".
    logSecurityEvent("authentication.login_failed", { cause: "missing captcha token" });
    return {
      ok: false,
      state: {
        status: "error",
        message: "Complete the CAPTCHA check, then try again.",
        email,
      },
    };
  }

  // Checked after the CAPTCHA, so throttle state cannot be probed without paying
  // for a token first, and before the password reaches Supabase, so a throttled
  // attempt costs an attacker a round trip and tells them nothing.
  const blockedUntil = await throttle.blockedUntil(email);
  if (blockedUntil) {
    logSecurityEvent("authentication.login_throttled", {
      blocked_for_seconds: Math.ceil((blockedUntil.getTime() - Date.now()) / 1000),
    });
    return {
      ok: false,
      state: { status: "error", message: throttleMessage(blockedUntil), email },
    };
  }

  try {
    const { data, error } = await client.auth.signInWithPassword({
      ...result.data,
      options: { captchaToken },
    });

    if (error || !data.user) {
      logSecurityEvent("authentication.login_failed", {
        cause: error?.message ?? "no user returned",
      });
      // A CAPTCHA rejection is not a credentials problem, and telling the user
      // their password is wrong when it is not sends them round a loop they
      // cannot escape. Credentials stay deliberately vague either way — the
      // message never reveals whether the email exists.
      const isCaptchaFailure = /captcha/i.test(error?.message ?? "");

      // Only a rejected *credential* counts towards the throttle. A CAPTCHA
      // rejection is already priced by Cloudflare, and counting it would let a
      // misbehaving widget — a stale token, a blocked script — throttle a user
      // who never typed a wrong password.
      if (!isCaptchaFailure) {
        const earned = await throttle.recordFailure(email);
        if (earned) {
          return {
            ok: false,
            state: { status: "error", message: throttleMessage(earned), email },
          };
        }
      }

      return {
        ok: false,
        state: {
          status: "error",
          message: isCaptchaFailure
            ? "CAPTCHA check failed. Please try again."
            : "Invalid email or password.",
          email,
        },
      };
    }

    // The password was right, so this was never a brute force — clear the count.
    await throttle.clear(email);

    // F013 AC2: a suspended user is turned away here rather than allowed to reach a
    // dashboard that immediately redirects them back. The session opened by
    // signInWithPassword is closed again on the way out.
    if (readActiveStatus) {
      const isActive = await readActiveStatus(data.user.id);
      if (isActive === false) {
        await client.auth.signOut();
        logSecurityEvent("permission.denied", { form: "login", reason: "inactive" });
        return {
          ok: false,
          state: { status: "pending", message: SUSPENDED_MESSAGE, email },
        };
      }
    }
  } catch (error) {
    logSecurityEvent("authentication.login_failed", {
      cause: error instanceof Error ? error.message : "Unknown error",
    });
    return {
      ok: false,
      state: { status: "error", message: SERVICE_UNAVAILABLE_MESSAGE, email },
    };
  }

  return { ok: true };
}
