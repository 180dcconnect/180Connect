/**
 * Category-tab vocabulary for the inbox triage tabs (Primary, Inbound Replies,
 * Awaiting Response, Follow-up Due, Starred), plus the pipeline guards that
 * keep decided outcomes out of the action queues.
 *
 * Pure and dependency-free so the server page, the client shell and plain
 * `node --test` can all import it. The `GmailCategoryTab` alias the shell
 * exports is this same union.
 */

/** The tabs rendered in the inbox tab bar. `sent` is deliberately absent: the
    shell's filter knows it, but no tab renders it — the Sent sidebar folder
    covers that view. */
export const INBOX_CATEGORY_TABS = [
  "primary",
  "inbound",
  "awaiting",
  "followup",
  "starred",
] as const;

export type InboxCategoryTab = (typeof INBOX_CATEGORY_TABS)[number];

/**
 * Reads `?tab=` from the URL. Unknown, missing and non-string values return
 * null so the caller falls back (deep-link derivation, then Primary) instead
 * of matching nothing.
 */
export function parseCategoryTabParam(value: unknown): InboxCategoryTab | null {
  if (typeof value !== "string") return null;
  return (INBOX_CATEGORY_TABS as readonly string[]).includes(value)
    ? (value as InboxCategoryTab)
    : null;
}

/**
 * The tab a deep-linked thread (`?thread=`) should land on when the URL
 * carries no explicit `?tab=`: the queue the thread belongs to. Anything that
 * is not clearly an inbound reply or an in-flight follow-up lands on Primary,
 * which shows everything — a wrong guess here must fail open, never strand a
 * thread on a tab that hides it.
 */
export function tabForThreadStatus(
  status: string | null | undefined,
): InboxCategoryTab {
  if (status === "replied") return "inbound";
  if (status === "awaiting") return "awaiting";
  return "primary";
}

/**
 * Human-closed outcomes: the engagement is decided (won, or dead), so the
 * thread leaves every triage queue — Inbound, Awaiting and Follow-up Due.
 * A post-conversion "thank you" reply is still real mail: it stays readable
 * in Primary, Sent and search, it just stops nagging.
 */
const CLOSED_PIPELINE_STATUSES: ReadonlySet<string> = new Set([
  "converted",
  "hard_no",
  "soft_no",
]);

/**
 * Parked outcomes: deliberately deferred, not dead. A parked client's fresh
 * reply is news (it stays in Inbound/Awaiting), but silence must not put it
 * in Follow-up Due — nudging a client a CAM just parked contradicts the
 * parking decision.
 */
const PARKED_PIPELINE_STATUSES: ReadonlySet<string> = new Set([
  "future_potential",
  "loss_due_timing",
]);

/**
 * Deliberately narrower than `MANUAL_TERMINAL_STATUSES`
 * (@/lib/responded-status.ts): `no_response` is system-set and revivable, and
 * the follow-up engine (`follow-up-recommendations.ts`) still recommends it —
 * hiding it here would make this tab disagree with the dashboard about the
 * same client. Unknown and null pipeline states fail open (actionable): a
 * thread must never vanish from triage over a missing column.
 */
export function isClosedPipelineStatus(
  status: string | null | undefined,
): boolean {
  return typeof status === "string" && CLOSED_PIPELINE_STATUSES.has(status);
}

export function isFollowUpExcludedPipelineStatus(
  status: string | null | undefined,
): boolean {
  return (
    typeof status === "string" &&
    (CLOSED_PIPELINE_STATUSES.has(status) ||
      PARKED_PIPELINE_STATUSES.has(status))
  );
}
