/**
 * The pure half of changing a password from /settings/profile.
 *
 * Distinct from the reset flow (`password-reset.ts`): there the emailed link is
 * the proof of identity, here it is the current password. The new password is
 * held to the same `PASSWORD_RULES` either way, so a password set from settings
 * is never weaker than one set from a reset link.
 */

// Relative, extension-qualified imports: unit-tested by `node --test`.
import { z } from "zod";

import { MAX_PASSWORD_LENGTH } from "./password-rules.ts";
import { passwordSchema } from "./password-reset.ts";

/**
 * Form state for the change-password panel. Declared here rather than in the
 * Server Action: a "use server" module may only export async functions.
 */
export type ChangePasswordState = {
  status: "idle" | "error" | "success";
  message?: string;
  fieldErrors?: {
    currentPassword?: string[];
    password?: string[];
    confirmPassword?: string[];
  };
};

export const CURRENT_PASSWORD_INCORRECT = "Your current password is incorrect.";

export const changePasswordSchema = z
  .object({
    currentPassword: z
      .string()
      .min(1, "Enter your current password.")
      .max(MAX_PASSWORD_LENGTH, "Password is too long."),
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((values) => values.password === values.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  })
  .refine((values) => values.password !== values.currentPassword, {
    message: "Choose a password different from your current one.",
    path: ["password"],
  });

export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

/** Coerces a FormData entry to a string, so a missing field fails as empty. */
export function formString(value: unknown): string {
  return typeof value === "string" ? value : "";
}
