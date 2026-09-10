import { containsRedactionPlaceholder } from "./ingestion/personal-data.ts";
import { emailField } from "./validation.ts";

export type ClientEmailStatus =
  | { status: "missing"; value: null; message: string }
  | { status: "redacted"; value: null; message: string }
  | { status: "invalid"; value: string; message: string }
  | { status: "valid"; value: string; message: null };

/**
 * What a CAM is told when the register published a personal address.
 *
 * It names the act ("removed"), the reason ("data policy") and the way out (a
 * role address), because the alternative — the row reading "Invalid" in red —
 * describes a broken import that never happened and asks someone to correct a
 * value nobody typed.
 */
export const REDACTED_EMAIL_MESSAGE =
  "A personal email address was published here and removed under our data policy. Add a role-based address (info@, enquiries@) before outreach.";

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

  // F247 redacts personal addresses in place, so this column can hold a
  // placeholder instead of an address. That is a third state, not a malformed
  // value: nothing was mistyped, and there is nothing here to "correct". The
  // null `value` is deliberate — it keeps the placeholder out of every caller
  // that renders or sends `.value`, so this is also the leak guard.
  if (containsRedactionPlaceholder(original)) {
    return { status: "redacted", value: null, message: REDACTED_EMAIL_MESSAGE };
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

/**
 * The stored contact address, or null where there is nothing to address.
 *
 * For callers that treat `organisations.contact_email` as a *recipient* rather
 * than as a value to display: a redaction placeholder is not an address, and
 * passing it through as "the address on file" puts `[redacted:personal-email]`
 * in a To field. A malformed address is deliberately not filtered here — that is
 * a real value someone typed, and the composer's own mismatch warning is where
 * it belongs.
 */
export function onFileEmail(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed || containsRedactionPlaceholder(trimmed)) return null;
  return trimmed;
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
