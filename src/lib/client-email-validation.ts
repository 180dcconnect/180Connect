import { emailField } from "./validation.ts";

export type ClientEmailStatus =
  | { status: "missing"; value: null; message: string }
  | { status: "invalid"; value: string; message: string }
  | { status: "valid"; value: string; message: null };

/**
 * F045's single format rule for canonical client email addresses.
 *
 * This deliberately returns a flag instead of throwing or rejecting the whole
 * organisation. Imports and manual entry may preserve useful records with a bad
 * email; only outreach using that field is blocked until it is corrected.
 */
export function validateClientEmail(value: string | null | undefined): ClientEmailStatus {
  const original = value?.trim() ?? "";
  if (!original) {
    return {
      status: "missing",
      value: null,
      message: "No contact email is recorded. Add a valid address before outreach.",
    };
  }

  const parsed = emailField().safeParse(original);
  if (!parsed.success) {
    return {
      status: "invalid",
      value: original,
      message: "This email address has an invalid format. Correct it before outreach.",
    };
  }

  return { status: "valid", value: parsed.data, message: null };
}

export type OutreachEmailDecision =
  | { allowed: true; recipient: string }
  | { allowed: false; warning: string };

/**
 * Last format/approval gate immediately before an outreach transport is invoked.
 * Future Gmail sending code must call this at the send boundary, not trust a badge
 * rendered earlier: records can change between page load and button press.
 */
export function canSendClientOutreach(
  email: string | null | undefined,
  explicitlyApproved: boolean,
): OutreachEmailDecision {
  const validation = validateClientEmail(email);
  if (validation.status !== "valid") {
    return { allowed: false, warning: validation.message };
  }
  if (!explicitlyApproved) {
    return {
      allowed: false,
      warning: "Review and explicitly approve the recipient before sending outreach.",
    };
  }
  return { allowed: true, recipient: validation.value };
}
