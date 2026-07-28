/**
 * HMAC helpers for the short-lived values this app hands to the browser.
 *
 * Two features keep security-relevant state in a cookie rather than a table —
 * the inactivity record (F007) and the password-recovery marker (F004) — so
 * both are attacker-controlled input that has to be verifiable on the way back
 * in. They shared the same twenty lines of Web Crypto before this module
 * existed; they now share one implementation, so a fix to either lands in both.
 */

/** HMAC-SHA-256 of `message` under `secret`, base64url-encoded. */
export async function signValue(message: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return Buffer.from(signature).toString("base64url");
}

/**
 * Compares two strings without leaking, through timing, how much of a forged
 * signature was correct.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}
