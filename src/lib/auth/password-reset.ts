/**
 * The pure half of the password-reset flow (F004).
 *
 * Everything here is framework-free so `node --test` can reach it: the Server
 * Actions and route handlers keep only the Supabase calls and the cookie I/O.
 *
 * The security-relevant part of this module is the *recovery marker*. Verifying
 * a recovery link necessarily produces a real Supabase session — that is the
 * only way `updateUser` can set a password — so the marker is what separates
 * "this session arrived through a reset link and may change the password" from
 * "this is an ordinary signed-in session". Two rules follow, and both matter:
 *
 *   1. **It is signed.** An unsigned marker is a plain cookie the holder of any
 *      session could set for themselves, turning a stolen session into a
 *      permanent account takeover: change the password, and the global sign-out
 *      that follows locks the real owner out. It is HMAC-signed with
 *      `SESSION_ACTIVITY_SECRET`, bound to the user id it was issued for.
 *   2. **It confines the session.** `src/lib/supabase/session-guard.ts` keeps a
 *      request carrying this marker out of the rest of the app, so clicking a
 *      reset link and then wandering off is not a way into the dashboard
 *      without a password or a CAPTCHA.
 */

// Relative, extension-qualified imports: this module is unit-tested by
// `node --test`, which resolves neither the `@/` alias nor bare .ts specifiers.
// Same convention as `src/lib/auth/login.ts`.
import { z } from "zod";

import { signValue, timingSafeEqual } from "../hmac.ts";
import { emailField } from "../validation.ts";
import { MAX_PASSWORD_LENGTH, PASSWORD_RULES } from "./password-rules.ts";

/**
 * Shown whether or not the address belongs to an account. Telling the two apart
 * would turn this form into a way to discover who has an account.
 */
export const RESET_REQUEST_MESSAGE =
  "If an account exists for that email, we’ve sent password reset instructions.";

/**
 * Covers expired, already-used and malformed links alike. Which one it was is
 * useful to the logs and to nobody else.
 */
export const RESET_LINK_ERROR =
  "This password reset link has expired or has already been used. Request a new link to continue.";

/**
 * Form state for the two reset screens.
 *
 * Declared here rather than in the Server Actions that produce them: a
 * "use server" module may only export async functions, and a type exported
 * from one can be emitted as a runtime export that fails on the client.
 */
export type ForgotPasswordState = {
  status: "idle" | "success" | "error";
  message?: string;
  fieldErrors?: { email?: string[] };
  email?: string;
};

export type ResetPasswordState = {
  status: "idle" | "error";
  message?: string;
  fieldErrors?: { password?: string[]; confirmPassword?: string[]; fullName?: string[] };
};

/** Cookie marking a session as being mid-recovery. */
export const RECOVERY_COOKIE_NAME = "180connect-password-recovery";

/** How long the marker lives when `PASSWORD_RESET_WINDOW_SECONDS` is unusable. */
export const DEFAULT_RECOVERY_WINDOW_SECONDS = 3600;

export const emailSchema = emailField().pipe(z.string().max(254));

/**
 * The new password must satisfy every rule in `PASSWORD_RULES` — deliberately
 * stricter than "whatever Supabase accepts", since this is the one moment the
 * app gets to raise the floor.
 *
 * `superRefine` rather than a chain of `.refine`s: a chain stops at the first
 * failure, and the form shows the user everything still missing at once.
 */
export const passwordSchema = z
  .string()
  .max(MAX_PASSWORD_LENGTH, "Password is too long.")
  .superRefine((value, ctx) => {
    for (const rule of PASSWORD_RULES) {
      if (!rule.test(value)) {
        ctx.addIssue({ code: "custom", message: rule.message });
      }
    }
  });

/**
 * Optional here because whether a name is actually required depends on
 * account state (does this user already have one?) that only the Server
 * Action can see — it re-checks and fills in `fieldErrors.fullName` itself.
 * See `setNewPassword` in `src/app/reset-password/actions.ts`.
 */
export const fullNameSchema = z.string().trim().max(120, "Name is too long.").optional();

export const newPasswordSchema = z
  .object({
    password: passwordSchema,
    confirmPassword: z.string(),
    fullName: fullNameSchema,
  })
  .refine((values) => values.password === values.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  });

/**
 * Marker lifetime in seconds, from `PASSWORD_RESET_WINDOW_SECONDS`.
 *
 * Falls back to the default for anything unusable rather than letting `NaN`
 * reach `Set-Cookie`, where it would silently produce a session cookie that
 * outlives the window it is meant to bound. `src/lib/env.ts` rejects a bad
 * value at check time; this is the runtime half of the same guarantee.
 */
export function recoveryWindowSeconds(
  source: Record<string, string | undefined> = process.env,
): number {
  const parsed = Number(source.PASSWORD_RESET_WINDOW_SECONDS);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.floor(parsed)
    : DEFAULT_RECOVERY_WINDOW_SECONDS;
}

/**
 * The secret the marker is signed with — the same one that signs the F007
 * activity record, under a distinct message prefix so a value minted for one
 * purpose can never be replayed as the other.
 */
export function recoverySecret(
  source: Record<string, string | undefined> = process.env,
): string | null {
  return source.SESSION_ACTIVITY_SECRET?.trim() || null;
}

/** Domain separation: this prefix is what the signature actually covers. */
function markerMessage(userId: string): string {
  return `password-recovery:${userId}`;
}

/**
 * Builds the marker cookie value for `userId`.
 *
 * With a secret the value is `<userId>.<hmac>`. Without one it is the bare id —
 * see `readRecoveryMarker` for why that is only tolerable outside production.
 */
export async function signRecoveryMarker(
  userId: string,
  secret: string | null = recoverySecret(),
): Promise<string> {
  if (!secret) return userId;
  return `${userId}.${await signValue(markerMessage(userId), secret)}`;
}

/**
 * Reads a marker cookie back into the user id it was issued for, or null if it
 * cannot be trusted. Null covers every failure — absent, malformed, wrong
 * signature — and callers treat null as "no reset in progress".
 *
 * @param isProduction - when true, an unsigned marker is rejected outright. A
 *   deployment with no `SESSION_ACTIVITY_SECRET` would otherwise accept a
 *   marker any session holder could forge, which is precisely the takeover this
 *   signature exists to prevent. Locally the unsigned form still works, so a
 *   developer without the secret set can still exercise the flow.
 */
export async function readRecoveryMarker(
  cookieValue: string | undefined,
  secret: string | null = recoverySecret(),
  isProduction: boolean = process.env.NODE_ENV === "production",
): Promise<string | null> {
  if (!cookieValue) return null;

  const separator = cookieValue.indexOf(".");
  const userId = separator === -1 ? cookieValue : cookieValue.slice(0, separator);
  const signature = separator === -1 ? null : cookieValue.slice(separator + 1);

  if (!userId) return null;

  if (!secret) return isProduction ? null : userId;

  if (!signature) return null;
  const expected = await signValue(markerMessage(userId), secret);
  if (!timingSafeEqual(signature, expected)) return null;

  return userId;
}

/** Cookie attributes for the marker. Shared so it is always written one way. */
export type RecoveryCookieOptions = {
  httpOnly: true;
  sameSite: "lax";
  secure: boolean;
  path: "/";
  maxAge: number;
};

export function recoveryCookieOptions(): RecoveryCookieOptions {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: recoveryWindowSeconds(),
  };
}

/**
 * Paths a mid-recovery session may still reach.
 *
 * `/reset-password` is the flow itself and `/auth/` is where the link lands.
 * `/forgot-password` and `/login` are the ways out: blocking them would trap
 * someone who abandoned the reset in a redirect loop with no escape but waiting
 * for the cookie to expire.
 */
const RECOVERY_ALLOWED_PREFIXES = [
  "/reset-password",
  "/forgot-password",
  "/login",
  "/auth/",
];

/** Whether a mid-recovery session is allowed to see `pathname`. */
export function isRecoveryAllowedPath(pathname: string): boolean {
  return RECOVERY_ALLOWED_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}
