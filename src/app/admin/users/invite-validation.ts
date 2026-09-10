/**
 * Client-side pre-flight for the invite form.
 *
 * This is the *third* layer, and the least authoritative one. The rule is
 * enforced by `check_allowed_email_domain()`, a BEFORE INSERT trigger on
 * `auth.users` (20260804160000), and again by `inviteSchema` in
 * `src/lib/auth/invite.ts`. Neither of those can stop the admin from typing a
 * gmail address, staging forty of them and pressing send before finding out —
 * that is what this is for. It must never be the only check, and it must agree
 * with `isOnAllowedDomain`, which is why it calls it rather than re-deriving
 * the rule (the old `email.endsWith("@180dc.org")` accepted
 * `attacker@evil.com@180dc.org` and ignored `AUTH_ALLOWED_EMAIL_DOMAIN`).
 */

// Relative with an explicit extension so `node --test` can import this module.
import { describeDomains, isOnAllowedDomain } from "../../../lib/auth/email-domain.ts";

/**
 * RFC 5321 limits: 64 octets for the local part, 254 for the whole address.
 * Postgres will not reject a longer one — GoTrue will, with a message nobody
 * can act on — so the form does.
 */
const MAX_LOCAL_PART = 64;
const MAX_EMAIL_LENGTH = 254;

/** Matches `fullName: z.string().trim().max(120)` in `inviteSchema`. */
const MAX_NAME_LENGTH = 120;

/**
 * A single send is one round trip per recipient (`sendBulkInvitesAction` loops
 * `sendInvite`), so a large paste is a long-running Server Action with no
 * progress and a real chance of hitting the platform's function timeout
 * part-way through — leaving some invites sent and no record of which.
 */
export const MAX_BULK_RECIPIENTS = 10;

/**
 * `null` when the address is safe to submit, otherwise the sentence to show.
 * Ordered cheapest-and-most-specific first, so the admin is told the one thing
 * that is actually wrong rather than a generic "invalid email".
 */
export function validateInviteEmail(raw: string, domains: readonly string[]): string | null {
  const email = raw.trim();

  if (email === "") return "Enter an email address.";
  if (/\s/.test(email)) return "An email address cannot contain spaces.";
  if (email.length > MAX_EMAIL_LENGTH) return "That email address is too long.";

  const parts = email.split("@");
  // Exactly one "@". Two is not an address on the second domain, it is
  // malformed — and it is the shape that defeats a suffix check.
  if (parts.length !== 2) return "Enter a valid email address.";

  const [localPart, domain] = parts;
  if (localPart === "") return "Enter a valid email address.";
  if (localPart.length > MAX_LOCAL_PART) return "That email address is too long.";
  if (domain === "" || !domain.includes(".")) return "Enter a valid email address.";
  if (domain.startsWith(".") || domain.endsWith(".") || domain.includes("..")) {
    return "Enter a valid email address.";
  }

  if (!isOnAllowedDomain(email, domains)) {
    return `Invites can only be sent to a ${describeDomains([...domains])} address.`;
  }

  return null;
}

/** `null` when the name is safe to submit, otherwise the sentence to show. */
export function validateInviteName(raw: string): string | null {
  const name = raw.trim();
  if (name === "") return "Enter their full name.";
  if (name.length > MAX_NAME_LENGTH) {
    return `Keep the name under ${MAX_NAME_LENGTH} characters.`;
  }
  return null;
}
