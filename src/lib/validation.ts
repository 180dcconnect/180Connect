/**
 * Shared server-side validation helpers (F222).
 *
 * Every form/Server Action/route handler should validate input with these
 * helpers rather than hand-rolling Zod calls, so error shape and messaging
 * stay consistent across the app. See `src/app/login/actions.ts` for the
 * reference usage.
 */

import { z } from "zod";

export type FieldErrors = Record<string, string[] | undefined>;

export type ValidationResult<T> =
  | { success: true; data: T }
  | { success: false; fieldErrors: FieldErrors };

/**
 * Runs a Zod schema against input and returns per-field errors instead of
 * throwing, so every failing field can be reported to the user at once
 * rather than one at a time.
 */
export function safeValidate<T>(
  schema: z.ZodType<T>,
  input: unknown,
): ValidationResult<T> {
  const parsed = schema.safeParse(input);

  if (!parsed.success) {
    return { success: false, fieldErrors: z.flattenError(parsed.error).fieldErrors };
  }

  return { success: true, data: parsed.data };
}

/** Trimmed, non-empty string capped at `max` characters. */
export function nonEmptyTrimmed(max: number, requiredMessage = "This field is required.") {
  return z
    .string()
    .trim()
    .min(1, requiredMessage)
    .max(max, `Must be ${max} characters or fewer.`);
}

/** Trimmed, lowercased email address. */
export function emailField(message = "Enter a valid email address.") {
  return z.string().trim().toLowerCase().pipe(z.email(message));
}

/** Absolute http:// or https:// URL. */
export function urlField(message = "Enter a valid URL.") {
  return z.string().trim().pipe(z.url({ protocol: /^https?$/, message }));
}

/**
 * Whole number within an inclusive range.
 *
 * Coerces numeric strings ("5" -> 5) but rejects empty/whitespace-only strings
 * rather than letting `Number("")` slip through as 0.
 */
export function boundedInt(min: number, max: number, message?: string) {
  return z.preprocess(
    (value) =>
      typeof value === "string"
        ? value.trim() === ""
          ? NaN
          : Number(value)
        : value,
    z
      .number()
      .int(message ?? `Must be a whole number between ${min} and ${max}.`)
      .min(min, message ?? `Must be at least ${min}.`)
      .max(max, message ?? `Must be at most ${max}.`),
  );
}
