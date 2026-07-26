/**
 * The message shown on /login after a logout (F006).
 *
 * `logout()` cannot hand state to the login page directly — it redirects — so
 * it appends a `signed_out` marker to the URL and this maps that marker to a
 * message. The mapping is deliberately closed: anything other than the two
 * known markers produces no notice at all, so a crafted link like
 * `/login?signed_out=Your%20account%20was%20deleted` cannot put attacker-chosen
 * text on our login page. The parameter selects a message; it never is one.
 */

export type SignedOutNotice = {
  /** How the message should read: a plain confirmation, or a caveat. */
  tone: "success" | "warning";
  message: string;
};

/** The marker `logout()` appends when the sign-out was confirmed. */
export const SIGNED_OUT = "1";
/** The marker it appends when the sign-out could not be confirmed. */
export const SIGNED_OUT_FAILED = "error";
/** The marker the proxy appends when a session was ended for inactivity (F007). */
export const SESSION_EXPIRED = "expired";

export function signedOutNotice(
  value: string | string[] | undefined,
): SignedOutNotice | null {
  // A repeated query parameter arrives as an array; take the first value.
  const marker = Array.isArray(value) ? value[0] : value;

  if (marker === SIGNED_OUT) {
    return { tone: "success", message: "You have been signed out." };
  }

  if (marker === SESSION_EXPIRED) {
    return {
      tone: "warning",
      message:
        "Your session expired after a period of inactivity. Please log in again.",
    };
  }

  if (marker === SIGNED_OUT_FAILED) {
    return {
      tone: "warning",
      message:
        "You have been signed out on this device, but we could not confirm the session ended everywhere. If you are on a shared computer, close the browser.",
    };
  }

  return null;
}
