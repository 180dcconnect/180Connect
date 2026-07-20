import { assertEnv } from "@/lib/env";

/**
 * Runs once per server instance, before any request is handled.
 *
 * Validating here means a missing or malformed environment variable stops the
 * server with a clear message, instead of producing a silent failure or an
 * unexpected error at request time (F231).
 */
export function register() {
  assertEnv();
}
