/**
 * Shared server-side validation helpers (F222).
 *
 * Every form/Server Action/route handler should validate input with these
 * helpers rather than hand-rolling Zod calls, so error shape and messaging
 * stay consistent across the app. See `src/lib/auth/login.ts` for the
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

/**
 * Route-param identity check: true only for a well-formed UUID. Route
 * handlers guard every lookup with this so a malformed id never reaches a
 * Postgres cast (which 500s) instead of a clean 400.
 */
export function isUuid(value: unknown): boolean {
  return z.uuid().safeParse(value).success;
}

/** A real calendar day in the database's YYYY-MM-DD format. */
export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

/**
 * Well-formed UUID, as a schema field.
 *
 * The schema half of `isUuid`: an id that arrives from the client — a route
 * param, a row id echoed back by a form — is checked here rather than by a
 * Postgres cast, which would 500 instead of refusing. Not for anything a person
 * types, and the message never names a table or a column.
 */
export function uuidField(message = "That identifier could not be read. Try again.") {
  return z.uuid(message);
}

/** Absolute http:// or https:// URL. */
export function urlField(message = "Enter a valid URL.") {
  return z.string().trim().pipe(z.url({ protocol: /^https?$/, message }));
}

/**
 * Optional @mention choices echoed back by a note composer, capped at `max`
 * entries. Each entry pairs the selected user id with the display name that
 * was spliced into the draft (`MentionedUserInput` in @/lib/note-mentions):
 * the server binds with the submitted name — the text actually in the note,
 * so a rename between composing and saving keeps a genuine mention — while
 * verifying the id is still an active user. Entries are machine-generated,
 * so a malformed shape fails the payload rather than notifying half a list.
 */
export function optionalMentionedUsers(max: number) {
  return z
    .array(z.object({ id: z.uuid(), name: z.string().trim().min(1).max(200) }))
    .max(max)
    .optional();
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
