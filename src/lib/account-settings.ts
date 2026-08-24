import { z } from "zod";

/**
 * Account settings (F200).
 *
 * Only one field is editable here: `USERS.full_name`. `email` and `role` are
 * deliberately absent — F200 AC2 keeps them off this screen, and the database
 * agrees: `create_users.sql` revokes all on `public.users` and grants back
 * `update (full_name)` alone, so a tampered POST that added `role` would be
 * rejected by Postgres even if this module let it through. The validation here
 * is about giving a person a clear message, not about being the security
 * boundary.
 */

/**
 * `USERS.full_name` is plain `text` with no length constraint, so the cap is an
 * application decision rather than a schema one. 120 is well past any real name
 * while still keeping the value renderable in the sidebar's account block.
 */
export const MAX_FULL_NAME_LENGTH = 120;

/**
 * C0/C1 control characters, plus the invisible formatting characters — zero-width
 * space and joiners, bidi marks, word joiner, BOM — that survive a `trim()` and
 * would otherwise let a name run past the length it appears to be.
 */
const INVISIBLE_CHARACTERS =
  /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029\u2060\ufeff]/g;

/**
 * Collapses runs of whitespace and strips the characters above. Done before the
 * length check so the cap applies to what actually gets stored.
 */
function normalizeName(value: string): string {
  return value.replace(INVISIBLE_CHARACTERS, " ").replace(/\s+/g, " ").trim();
}

export const fullNameSchema = z
  .string()
  .transform(normalizeName)
  .pipe(
    z
      .string()
      .min(1, "Enter your name.")
      .max(
        MAX_FULL_NAME_LENGTH,
        `Name must be ${MAX_FULL_NAME_LENGTH} characters or fewer.`,
      ),
  );

export const NOTIFICATION_FREQUENCIES = ["immediate", "daily", "weekly"] as const;
export type NotificationFrequency = (typeof NOTIFICATION_FREQUENCIES)[number];

export const NOTIFICATION_FREQUENCY_LABELS: Record<NotificationFrequency, string> = {
  immediate: "Immediate",
  daily: "Daily digest",
  weekly: "Weekly digest",
};

export const NOTIFICATION_FREQUENCY_DESCRIPTIONS: Record<NotificationFrequency, string> = {
  immediate: "Receive alerts in real time as events and updates occur.",
  daily: "Get a daily summary digest of relevant updates and follow-up reminders.",
  weekly: "Receive a weekly roundup of team activity and pending items.",
};

export const notificationFrequencySchema = z.enum(NOTIFICATION_FREQUENCIES);

export const INVALID_NOTIFICATION_FREQUENCY_MESSAGE =
  "Choose a notification delivery frequency.";

export const accountSettingsSchema = z.object({
  fullName: fullNameSchema,
  notificationFrequency: notificationFrequencySchema,
});

export type AccountSettingsInput = z.infer<typeof accountSettingsSchema>;

export type ParsedAccountSettings =
  | { ok: true; value: AccountSettingsInput }
  | { ok: false; message: string };

/**
 * Parses the submitted form into the fields this screen may write (F200 / F201).
 *
 * A missing `full_name` entry is treated as an empty string rather than as a
 * separate "field absent" error: to the person filling in the form the two are
 * the same mistake, and the message they need is identical.
 *
 * `notification_frequency` gets no such leniency (F201 review): a missing or
 * tampered value is rejected outright rather than silently resetting the
 * person's saved cadence to `immediate` under a success message. The edit form
 * always submits one of the three radio options, so reaching here without a
 * valid value means the field was dropped or forged — never a legitimate save.
 */
export function parseAccountSettings(input: {
  fullName: unknown;
  notificationFrequency?: unknown;
}): ParsedAccountSettings {
  if (
    typeof input.notificationFrequency !== "string" ||
    !NOTIFICATION_FREQUENCIES.includes(
      input.notificationFrequency as NotificationFrequency,
    )
  ) {
    return {
      ok: false,
      message: INVALID_NOTIFICATION_FREQUENCY_MESSAGE,
    };
  }

  const result = accountSettingsSchema.safeParse({
    fullName: typeof input.fullName === "string" ? input.fullName : "",
    notificationFrequency: input.notificationFrequency,
  });

  if (!result.success) {
    return {
      ok: false,
      message: result.error.issues[0]?.message ?? "Check your details and try again.",
    };
  }

  return { ok: true, value: result.data };
}
