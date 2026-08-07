/**
 * Small display formatters shared by anything that renders an ORGANISATIONS row —
 * originally the F051 charity list (visible-clients.ts, which re-exports these for
 * its existing callers), now also the F068 client detail basic-info section
 * (client-basic-info.ts). Kept dependency-free so both can import it under plain
 * `node --test` without a bundler resolving path aliases.
 */

/** City if we have one, otherwise the ISO country code — country_code is never null. */
export function formatLocation(organisation: { city: string | null; country_code: string }): string {
  return organisation.city?.trim() || organisation.country_code;
}

/** "not_started" -> "Not started". */
export function formatOutreachStatus(status: string): string {
  const spaced = status.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** F145/F146-F155 — the ten pipeline statuses a client can be in, in the order the
 * tickets define them. `not_contacted` (F146) is the default for a new client. */
export const PIPELINE_STATUSES = [
  "not_contacted",
  "initial_outreach_sent",
  "follow_up_sent",
  "responded",
  "converted",
  "future_potential",
  "soft_no",
  "hard_no",
  "no_response",
  "loss_due_timing",
] as const;

export type PipelineStatus = (typeof PIPELINE_STATUSES)[number];
