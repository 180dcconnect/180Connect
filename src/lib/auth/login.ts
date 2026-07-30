/**
 * The login decision (F001), separated from the Server Action that calls it.
 *
 * `src/app/login/actions.ts` cannot be imported by a test: `"use server"` and
 * `next/navigation`'s `redirect` only work inside a request. So the part worth
 * testing — domain restriction, the deliberately vague credentials message,
 * the pending-activation branch — lives here behind an injectable client, the
 * same shape `signOutAndReport` uses. The action keeps only the Supabase
 * client construction and the redirect.
 */

import type { User } from "@supabase/supabase-js";
import { z } from "zod";

import { logSecurityEvent } from "../log-security-event.ts";
import { emailField, safeValidate } from "../validation.ts";
import { NO_THROTTLE, throttleMessage, type LoginThrottle } from "./login-throttle.ts";
import { permissionFailureMessage, requireApprovedUser } from "./require-approved-user.ts";

/** Used when AUTH_ALLOWED_EMAIL_DOMAIN is unset. */
export const DEFAULT_ALLOWED_EMAIL_DOMAIN = "180dc.org";

/**
 * The domain users must sign in from, as a bare domain. Read per call rather
 * than at module load so a test (or a restarted server) sees the current value.
 */
export function allowedEmailDomain(
  env: Record<string, string | undefined> = process.env,
): string {
  return (env.AUTH_ALLOWED_EMAIL_DOMAIN ?? DEFAULT_ALLOWED_EMAIL_DOMAIN)
    .trim()
    .toLowerCase()
    .replace(/^@/, "");
}

/** Trims and lowercases a submitted email so echo-back and lookup agree. */
export function normalizeEmail(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

export function loginSchema(domain: string = allowedEmailDomain()) {
  return z.object({
    email: emailField("Enter a valid email address.").refine(
      (email) => email.endsWith(`@${domain}`),
      { message: `Use your @${domain} email address.` },
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
 * Validates the submission, checks the CAPTCHA was solved, checks the account is
 * not throttled, signs in, and confirms the account is approved. Never throws: a
 * transport failure comes back as `SERVICE_UNAVAILABLE_MESSAGE` so the action can
 * render it.
 *
 * `throttle` defaults to the no-op so the twenty-odd tests that predate it read
 * unchanged; the Server Action always passes a real one.
 */
export async function attemptLogin(
  client: LoginClient,
  input: LoginInput,
  domain: string = allowedEmailDomain(),
  throttle: LoginThrottle = NO_THROTTLE,
): Promise<LoginOutcome> {
  const email = normalizeEmail(input.email);
  const result = safeValidate(loginSchema(domain), { email, password: input.password });

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

    // The password was right, so this was never a brute force — clear the count
    // even if the account turns out to be unapproved below.
    await throttle.clear(email);

    const permission = requireApprovedUser(data.user);
    if (!permission.ok) {
      await client.auth.signOut();
      logSecurityEvent("permission.denied", { form: "login", reason: permission.reason });
      return {
        ok: false,
        state: {
          status: "pending",
          message: permissionFailureMessage(permission.reason),
          email,
        },
      };
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
