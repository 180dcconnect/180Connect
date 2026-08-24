/**
 * F236. Shown when a client-side fetch throws (offline, DNS, timeout) rather than
 * returning a response, so there is no server-supplied `error` string to display.
 * Previously duplicated near-verbatim across half a dozen components.
 */
export const NETWORK_ERROR_MESSAGE =
  "Could not reach the server. Check your connection and try again.";
