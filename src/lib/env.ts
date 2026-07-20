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
    required: false,
    secret: false,
    description:
      "Supabase project URL for this environment. Not yet consumed — becomes required when the database client lands (F223).",
    validate: isAbsoluteHttpUrl,
  },
  {
    name: "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    required: false,
    secret: false,
    description:
      "Supabase anonymous/publishable key. Safe to expose to the browser; access is still constrained by row-level security. Not yet consumed — becomes required with F223.",
  },
  {
    name: "SUPABASE_SERVICE_ROLE_KEY",
    required: false,
    secret: true,
    description:
      "Supabase service-role key. Bypasses row-level security — server-side only, never prefixed with NEXT_PUBLIC_. Not yet consumed — becomes required with F223.",
  },
  {
    name: "CRON_SECRET",
    required: false,
    secret: true,
    description:
      "Shared secret the scheduled-send route handler checks before doing any work, so the endpoint cannot be triggered by anyone who finds the URL. Not yet consumed — see Q-02 in docs/open-questions.md.",
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

  return problems;
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
