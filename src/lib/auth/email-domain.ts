/**
 * The allowed-email-domain rule, on its own so a Client Component can import it.
 *
 * It used to live in `login.ts`, which pulls in zod, `@supabase/supabase-js`
 * types and `logSecurityEvent` — none of which belong in a browser bundle just
 * so an invite form can tell the admin which domain to type. `login.ts`
 * re-exports everything here, so every existing import still resolves.
 *
 * `allowedEmailDomains()` reads `process.env` and is therefore server-only in
 * practice; a Client Component takes the resolved list as a prop and uses the
 * pure predicates below.
 */

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
