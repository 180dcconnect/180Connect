/**
 * The rules a new password must satisfy (F004).
 *
 * These live apart from `password-reset.ts` for two reasons: the reset form is
 * a client component and must not pull the server-only crypto in that module
 * into the browser bundle, and both halves have to agree. `passwordSchema` is
 * built from this list and the checklist is rendered from it, so a rule can
 * never be enforced without being shown or shown without being enforced.
 */

export type PasswordRule = {
  /** Stable key for React and for tests. */
  id: string;
  /** Shown in the checklist, phrased as the thing the password needs. */
  label: string;
  /** Shown as a validation error, phrased as an instruction. */
  message: string;
  test: (value: string) => boolean;
};

export const MAX_PASSWORD_LENGTH = 256;

export const PASSWORD_RULES: readonly PasswordRule[] = [
  {
    id: "length",
    label: "At least 12 characters",
    message: "Use at least 12 characters.",
    test: (value) => value.length >= 12,
  },
  {
    id: "lowercase",
    label: "A lowercase letter",
    message: "Include a lowercase letter.",
    test: (value) => /[a-z]/.test(value),
  },
  {
    id: "uppercase",
    label: "An uppercase letter",
    message: "Include an uppercase letter.",
    test: (value) => /[A-Z]/.test(value),
  },
  {
    id: "number",
    label: "A number",
    message: "Include a number.",
    test: (value) => /[0-9]/.test(value),
  },
];

/** Which rules `value` currently satisfies, keyed by rule id. */
export function checkPassword(value: string): Record<string, boolean> {
  return Object.fromEntries(
    PASSWORD_RULES.map((rule) => [rule.id, rule.test(value)]),
  );
}
