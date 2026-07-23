/**
 * Seed script configuration and safety guards (F233).
 *
 * The seed script writes fake data and deletes rows in bulk. Pointed at the wrong
 * database it would destroy real client records, so every check that decides
 * *whether it may run at all* lives here, as pure functions over an environment
 * record. That keeps the dangerous logic testable without a database and without
 * mutating `process.env`.
 *
 * Two independent guards, per F233 AC4:
 *   1. Refuse to run against production — by environment tag *and* by project ref,
 *      because either one alone can be wrong (a local shell has no VERCEL_ENV, and
 *      NODE_ENV says nothing about which project the URL points at).
 *   2. Every row written carries `is_seed = true` (see `fixtures.ts`).
 *
 * There is deliberately no override flag. An escape hatch on a guard like this
 * eventually gets used.
 */

/** Supabase project ref for `180connect-production`. Seeding this is never allowed. */
export const PRODUCTION_PROJECT_REF = "tugfhwiqvwrpvawpjwmd";

/** Supabase project ref for `180connect-staging`, a valid seed target. */
export const STAGING_PROJECT_REF = "cgbfhhdeapasniudyyds";

/** The environment variable holding the Postgres connection string. */
export const DB_URL_VAR = "SUPABASE_DB_URL";

/** Raised when the script must not run. Carries a message meant for a human. */
export class SeedRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SeedRefusedError";
  }
}

/** Raised when configuration is missing or unusable. */
export class SeedConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SeedConfigError";
  }
}

export type SeedConfig = {
  /** Postgres connection string for the target database. */
  databaseUrl: string;
  /** Supabase project ref parsed from the connection string, if it has one. */
  projectRef?: string;
  /** Human-readable target description for the console banner. Never a secret. */
  target: string;
};

/**
 * Extracts the Supabase project ref from a Postgres connection string.
 *
 * Supabase exposes two shapes, and the ref sits in a different place in each:
 *   direct:  postgresql://postgres:<pw>@db.<ref>.supabase.co:5432/postgres
 *   pooler:  postgresql://postgres.<ref>:<pw>@aws-0-<region>.pooler.supabase.com:6543/postgres
 *
 * Returns `undefined` for anything else — a local database, most obviously, which
 * has no project ref and is a perfectly valid seed target.
 */
export function extractProjectRef(databaseUrl: string): string | undefined {
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    return undefined;
  }

  const fromHost = /^db\.([a-z0-9]{20})\.supabase\.(co|com)$/i.exec(url.hostname);
  if (fromHost) return fromHost[1];

  const fromUser = /^postgres\.([a-z0-9]{20})$/i.exec(
    decodeURIComponent(url.username),
  );
  if (fromUser) return fromUser[1];

  return undefined;
}

/** True when the environment declares itself to be production. */
export function isProductionEnvironment(
  source: Record<string, string | undefined>,
): boolean {
  const tags = [
    source.NODE_ENV,
    source.VERCEL_ENV,
    source.SENTRY_ENVIRONMENT,
  ].map((value) => value?.trim().toLowerCase());
  return tags.includes("production");
}

/**
 * Resolves and validates the seed target.
 *
 * Throws {@link SeedConfigError} when configuration is missing or malformed, and
 * {@link SeedRefusedError} when the target is production. Both carry a message
 * that says what to do next — a silent no-op here is the failure mode F233 AC6
 * exists to prevent.
 */
export function resolveSeedConfig(
  source: Record<string, string | undefined>,
): SeedConfig {
  if (isProductionEnvironment(source)) {
    throw new SeedRefusedError(
      "Refusing to seed: the environment is tagged production " +
        `(NODE_ENV=${source.NODE_ENV ?? "unset"}, VERCEL_ENV=${source.VERCEL_ENV ?? "unset"}). ` +
        "Seed data must never be written to production.",
    );
  }

  const databaseUrl = source[DB_URL_VAR]?.trim();
  if (!databaseUrl) {
    throw new SeedConfigError(
      `${DB_URL_VAR} is required but not set.\n` +
        "  It is the Postgres connection string for the database you want to seed.\n" +
        "  Supabase dashboard -> Project Settings -> Database -> Connection string (URI).\n" +
        "  Add it to .env.local — see docs/environment-variables.md.",
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new SeedConfigError(
      `${DB_URL_VAR} is not a valid connection string. ` +
        "Expected a URI of the form postgresql://user:password@host:port/database.",
    );
  }

  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new SeedConfigError(
      `${DB_URL_VAR} must be a postgres:// or postgresql:// URI, not ${parsed.protocol}//.`,
    );
  }

  const projectRef = extractProjectRef(databaseUrl);

  if (projectRef === PRODUCTION_PROJECT_REF) {
    throw new SeedRefusedError(
      `Refusing to seed: ${DB_URL_VAR} points at the production Supabase project ` +
        `(${PRODUCTION_PROJECT_REF}, 180connect-production). ` +
        "Point it at 180connect-staging or a local database.",
    );
  }

  // Host and port are safe to print; the password in the URI is not, so the banner
  // is built from parts rather than from the connection string itself.
  const target = projectRef
    ? `${parsed.hostname} (project ${projectRef}${
        projectRef === STAGING_PROJECT_REF ? ", 180connect-staging" : ""
      })`
    : `${parsed.hostname}:${parsed.port || "5432"}`;

  return { databaseUrl, projectRef, target };
}
