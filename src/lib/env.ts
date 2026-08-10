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

function isBareDomainList(value: string): string | null {
  // One domain, or several separated by commas. A leading "@" is tolerated by
  // src/lib/auth/login.ts, so accept it here too.
  const domains = value.split(",").map((entry) => entry.trim().replace(/^@/, ""));

  if (domains.some((domain) => domain === "")) {
    return "must not contain an empty entry — check for a stray or trailing comma";
  }

  if (!domains.every((domain) => /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(domain))) {
    return "must be a bare domain, or a comma-separated list of them, for example 180dc.org,example.com";
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
      "Email domain(s) users may sign in from — one, or a comma-separated list. Server-only, never prefixed with NEXT_PUBLIC_. Defaults to 180dc.org when unset. This is the friendly half of a two-layer rule: Postgres decides, via app.allowed_email_domains and the trigger on auth.users (20260804160000). Keep the two in step — widening this alone can never let anybody in, it only changes the message the form shows.",
    validate: isBareDomainList,
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
      "Supabase service-role key. Bypasses row-level security — server-side only, never prefixed with NEXT_PUBLIC_. Read by `src/lib/supabase/admin.ts`, which has two callers. The F227 login throttle: its RPCs are granted to service_role alone, because a failed-login counter that anon could increment over the REST API would let anyone keep a chosen account delayed without solving a CAPTCHA. And F013's suspended-user check at login, which cannot read `users.is_active` as the user themselves — `users_select_active` gates SELECT on the reader being active, so a suspended user's own row is invisible to them. Optional locally, where an absent key degrades the throttle to a no-op (CAPTCHA and Supabase's per-IP limits stay in place) and makes a suspended user meet a worse error message rather than a way in, since `getCurrentActor` refuses them regardless. Session revocation does not use this key; it happens inside `set_user_active`. Staging and production must set it, or brute-force throttling is silently off. Becomes required with F223.",
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
      "Shared secret the cron route handlers check before doing any work, so an endpoint cannot be triggered by anyone who finds the URL. Consumed by src/app/api/cron/companies-house-import and companies-house-status-recheck (pg_cron-triggered, see supabase/migrations/20260809100400_schedule_companies_house_cron.sql), which also set the Q-02 precedent for the still-unbuilt scheduled-send worker in docs/open-questions.md.",
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
  {
    name: "RESEND_API_KEY",
    required: false,
    secret: true,
    description:
      "Resend API key for transactional platform email — the F008 invite today, notification mail later. Server-side only, never prefixed with NEXT_PUBLIC_. Optional by design: with no key set, `src/lib/email/send.ts` falls back to logging each message to the console instead of sending it, so local development and CI can never email a real person. Not used for client outreach, which PRD §12.1 sends from each CAM's own Gmail account.",
    validate: (value) =>
      value.startsWith("re_") ? null : "must be a Resend API key, which begins with re_",
  },
  {
    name: "EMAIL_FROM",
    required: false,
    secret: false,
    description:
      "Sender for transactional platform email, either a bare address or `Name <address>`. The domain must be verified with Resend — an unverified sender is rejected outright, and Resend's own onboarding@resend.dev only ever delivers to the account owner's address, so it is not usable for inviting anyone else. Required whenever RESEND_API_KEY is set; ignored otherwise.",
    validate: (value) =>
      /^[^<>]*<[^@<>\s]+@[^@<>\s]+\.[^@<>\s]+>$|^[^@<>\s]+@[^@<>\s]+\.[^@<>\s]+$/.test(value)
        ? null
        : "must be an email address, optionally as `Name <address@example.com>`",
  },
  {
    name: "EMAIL_RECIPIENT_ALLOWLIST",
    required: false,
    secret: false,
    description:
      "Comma-separated addresses or bare domains that transactional email may be delivered to. Any other recipient is dropped and logged rather than sent. Unset means no restriction, which is the production setting. Set it anywhere a real charity contact could be emailed by accident — staging, or a developer sending from a domain that is not 180DC's.",
  },
  {
    name: "COMPANIES_HOUSE_API_KEY",
    required: false,
    secret: true,
    description:
      "Companies House API key for company data ingestion (F038). HTTP Basic Auth — sent as the username with a blank password. Not yet required — becomes required once F032 (Companies House data import) ships.",
  },
  {
    name: "CHARITYBASE_API_KEY",
    required: false,
    secret: true,
    description:
      "CharityBase API key for charity data ingestion (F038/F031). GraphQL API — sent as `Authorization: Apikey <key>`. Not yet required — becomes required once F031 (CharityBase data import) ships, and CharityBase's own API is currently down on their end.",
  },
  {
    name: "CHARITY_COMMISSION_API_KEY",
    required: false,
    secret: true,
    description:
      "Charity Commission API key for charity data ingestion (F038/F033). Sent as `Ocp-Apim-Subscription-Key`. Not yet required — becomes required once F033 (Charity Commission data import) ships.",
  },
  {
    name: "CHARITY_COMMISSION_BACKFILL_START",
    required: false,
    secret: false,
    description:
      "Start date (YYYY-MM-DD) for Charity Commission imports via GetSearchCharityByRegDate (F033). Optional — defaults to 2000-01-01 if unset.",
    validate: (value) =>
      /^\d{4}-\d{2}-\d{2}$/.test(value) ? null : "must be in YYYY-MM-DD format",
  },
  {
    name: "CHARITY_COMMISSION_BACKFILL_END",
    required: false,
    secret: false,
    description:
      "End date (YYYY-MM-DD) for Charity Commission imports via GetSearchCharityByRegDate (F033). Optional — defaults to today if unset.",
    validate: (value) =>
      /^\d{4}-\d{2}-\d{2}$/.test(value) ? null : "must be in YYYY-MM-DD format",
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
  problems.push(...requireSenderWhenSendingEmail(source));

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

/**
 * Neither email variable is required on its own — an environment that sends no
 * email is valid, and that is the local default. But a key without a sender is
 * a deployment that believes it can send and cannot: every invite would be
 * refused at the provider, at send time, one silent failure at a time. Catch
 * the pair at startup instead.
 */
function requireSenderWhenSendingEmail(
  source: Record<string, string | undefined>,
): EnvProblem[] {
  if (!source.RESEND_API_KEY?.trim() || source.EMAIL_FROM?.trim()) {
    return [];
  }

  return [
    {
      name: "EMAIL_FROM",
      problem: "is required when RESEND_API_KEY is set (a sender on a verified domain)",
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
