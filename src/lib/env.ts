/**
 * Environment variable schema and validation (F231).
 *
 * Every configuration value that differs between environments lives here.
 * Nothing that differs between environments should be hardcoded elsewhere in
 * the codebase — add it to `SCHEMA` instead, and to `.env.example`.
 *
 * Validation runs at server startup via `src/instrumentation.ts`, so a missing
 * required variable fails loudly and immediately rather than surfacing as a
 * confusing runtime error later.
 */

export type EnvVarSpec = {
  /** The variable name, exactly as it appears in the environment. */
  name: string;
  /**
   * Whether the app refuses to start without it. A variable becomes required
   * once the feature that consumes it is merged — see `docs/environment-variables.md`.
   */
  required: boolean;
  /** Whether the value is a secret. Secret values are never echoed in errors or logs. */
  secret: boolean;
  /** What the variable is for. Mirrored into `.env.example`. */
  description: string;
  /** Optional extra validation. Return an error message, or null if the value is acceptable. */
  validate?: (value: string) => string | null;
};

const NOT_A_URL =
  "must be an absolute http:// or https:// URL, for example http://localhost:3000";

function isAbsoluteHttpUrl(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return NOT_A_URL;
  }
  // Note: `new URL("localhost:3000")` succeeds, with a protocol of "localhost:".
  // The protocol check below is what actually rejects a bare host:port.
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return NOT_A_URL;
  }
  return null;
}

function isBareDomain(value: string): string | null {
  // A leading "@" is tolerated by src/lib/auth/login.ts, so accept it here too.
  const domain = value.replace(/^@/, "");
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(domain)) {
    return "must be a bare domain, for example 180dc.org";
  }
  return null;
}

function isTurnstileSiteKey(value: string): string | null {
  // Real keys are `0x…`; Cloudflare's documented test keys are `1x…`, `2x…`
  // and `3x…`. Anything else is a copy-paste error — most likely the *secret*
  // key, which must never reach the browser bundle.
  if (!/^[0-3]x[A-Za-z0-9_-]+$/.test(value)) {
    return "must be a Cloudflare Turnstile site key, for example 1x00000000000000000000AA";
  }
  return null;
}

export const SCHEMA: readonly EnvVarSpec[] = [
  {
    name: "NEXT_PUBLIC_APP_URL",
    required: true,
    secret: false,
    description:
      "Absolute base URL this deployment is served from. Used to build links in emails and redirects, which cannot be derived reliably from the request in every environment.",
    validate: isAbsoluteHttpUrl,
  },
  {
    name: "NEXT_PUBLIC_SUPABASE_URL",
    required: true,
    secret: false,
    description:
      "Supabase project URL for this environment. Read by `src/lib/supabase/server.ts`.",
    validate: isAbsoluteHttpUrl,
  },
  {
    name: "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    required: false,
    secret: false,
    description:
      "Supabase publishable key. Safe to expose to the browser; access is still constrained by row-level security. Required unless NEXT_PUBLIC_SUPABASE_ANON_KEY is set instead — see `requireOneSupabaseKey`.",
  },
  {
    name: "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    required: false,
    secret: false,
    description:
      "Legacy name for the publishable key, read as a fallback by `src/lib/supabase/server.ts`. Prefer NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.",
  },
  {
    name: "AUTH_ALLOWED_EMAIL_DOMAIN",
    required: false,
    secret: false,
    description:
      "Email domain users must sign in from. Server-only — never prefix with NEXT_PUBLIC_. Defaults to 180dc.org in `src/lib/auth/login.ts` when unset.",
    validate: isBareDomain,
  },
  {
    name: "PASSWORD_RESET_WINDOW_SECONDS",
    required: false,
    secret: false,
    description:
      "Password-recovery link lifetime in seconds. Optional and defaults to 3600; keep it aligned with the recovery OTP expiry configured in Supabase Auth.",
    validate: (value) =>
      /^\d+$/.test(value) && Number(value) > 0
        ? null
        : "must be a positive whole number of seconds",
  },
  {
    name: "NEXT_PUBLIC_TURNSTILE_SITE_KEY",
    required: true,
    secret: false,
    description:
      "Cloudflare Turnstile site key for the login CAPTCHA (F003). Public by design — it identifies the widget, and only the paired secret held by Supabase can validate a token. Cloudflare's always-pass test key 1x00000000000000000000AA is the right value for local development and CI.",
    validate: isTurnstileSiteKey,
  },
  {
    name: "SUPABASE_SERVICE_ROLE_KEY",
    required: false,
    secret: true,
    description:
      "Supabase service-role key. Bypasses row-level security — server-side only, never prefixed with NEXT_PUBLIC_. Not yet consumed — becomes required with F223.",
  },
  {
    name: "SESSION_ACTIVITY_SECRET",
    required: false,
    secret: true,
    description:
      "Key used to HMAC-sign the inactivity record that drives session expiry (F007) and the password-recovery marker (F004). Server-only — never prefixed with NEXT_PUBLIC_. Optional locally, but staging and production must set it: without it the inactivity timestamp is unsigned and a replayed session could forge a fresh one, and password reset refuses to run at all rather than trust a marker any session holder could forge. Any long random string works, for example `openssl rand -base64 32`. Changing it expires every open session once.",
    validate: (value) =>
      value.length < 32 ? "must be at least 32 characters of random data" : null,
  },
  {
    name: "SUPABASE_DB_URL",
    required: false,
    secret: true,
    description:
      "Postgres connection string for the database the seed script writes to (F233). Used only by `npm run seed`, never by the app, so it stays optional — the script validates it itself and refuses to run against production.",
  },
  {
    name: "CRON_SECRET",
    required: false,
    secret: true,
    description:
      "Shared secret the scheduled-send route handler checks before doing any work, so the endpoint cannot be triggered by anyone who finds the URL. Not yet consumed — see Q-02 in docs/open-questions.md.",
  },
  {
    name: "NEXT_PUBLIC_SENTRY_DSN",
    required: false,
    secret: false,
    description:
      "Sentry Data Source Name — where captured errors are sent (F226). Public by design: a DSN only permits writing events, so it is safe in the browser bundle. Leave unset to log errors to the platform console instead of Sentry.",
    validate: isAbsoluteHttpUrl,
  },
  {
    name: "SENTRY_ENVIRONMENT",
    required: false,
    secret: false,
    description:
      "Environment tag applied to captured errors — 'staging' or 'production' (F226). Optional: falls back to Vercel's VERCEL_ENV so staging (preview) and production are distinguished automatically.",
  },
];

export type EnvProblem = {
  name: string;
  problem: string;
};

/**
 * Checks the given environment against `SCHEMA`.
 *
 * Takes the environment as an argument rather than reading `process.env`
 * directly so the failure paths can be tested without mutating global state.
 * Returns problems rather than throwing, so every problem can be reported at
 * once instead of one per restart.
 */
export function collectEnvProblems(
  source: Record<string, string | undefined>,
): EnvProblem[] {
  const problems: EnvProblem[] = [];

  for (const spec of SCHEMA) {
    const raw = source[spec.name];
    const value = raw?.trim();

    if (!value) {
      if (spec.required) {
        problems.push({ name: spec.name, problem: "is required but not set" });
      }
      continue;
    }

    const failure = spec.validate?.(value);
    if (failure) {
      problems.push({ name: spec.name, problem: failure });
    }
  }

  problems.push(...requireOneSupabaseKey(source));

  return problems;
}

/**
 * The Supabase client accepts either key name, so neither can be marked
 * `required` on its own — that would reject a valid environment that sets only
 * the other. This checks the pair instead.
 */
function requireOneSupabaseKey(
  source: Record<string, string | undefined>,
): EnvProblem[] {
  if (
    source.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ||
    source.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim()
  ) {
    return [];
  }

  return [
    {
      name: "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      problem:
        "is required but not set (or set NEXT_PUBLIC_SUPABASE_ANON_KEY instead)",
    },
  ];
}

/** Builds the startup error message. Never includes any variable's value. */
export function formatEnvProblems(problems: readonly EnvProblem[]): string {
  const lines = problems.map(({ name, problem }) => `  - ${name} ${problem}`);

  return [
    `Environment is not configured correctly (${problems.length} problem${
      problems.length === 1 ? "" : "s"
    }):`,
    ...lines,
    "",
    "Copy .env.example to .env.local and fill in the values.",
    "See docs/environment-variables.md for what each variable is and where to get it.",
  ].join("\n");
}

/**
 * Validates `process.env` and throws if anything is wrong.
 * Called once at server startup from `src/instrumentation.ts`.
 */
export function assertEnv(
  source: Record<string, string | undefined> = process.env,
): void {
  const problems = collectEnvProblems(source);
  if (problems.length > 0) {
    throw new Error(formatEnvProblems(problems));
  }
}

/**
 * Validated configuration for use in application code.
 *
 * `NEXT_PUBLIC_*` variables are read with static property access on purpose:
 * Next.js inlines them into the client bundle at build time by textual
 * substitution, and a dynamic lookup such as `process.env[name]` would not be
 * replaced. Do not refactor these into a loop.
 */
export const env = {
  appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "",
} as const;
