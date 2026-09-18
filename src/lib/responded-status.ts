// F149: Responded Status — pure decision logic.
//
// AC1: the status updates to 'responded' automatically when a reply is
// detected and linked — a system-triggered change, not a CAM manually
// picking a status. This is a genuinely different action from
// set_outreach_status (src/lib/pipeline-status.ts), which the RPC itself
// comments as "ordinary MANUAL status change" requiring an authenticated
// owner/admin actor. A background reply-detection process has no such
// actor to check permission against, so this needs its own path, not a
// reuse of the manual one.
//
// AC2: 'responded' is intermediate — it must never override a status that
// represents a deliberate, final human decision. The enum's own comments
// (20260807100000_redefine_outreach_status_pipeline.sql) mark six values
// "(manual)": converted, future_potential, soft_no, hard_no, no_response,
// loss_due_timing. A reply arriving after a CAM already closed the
// engagement one of those ways must not silently reopen it by flipping the
// status back to 'responded' — the CAM's decision stands until they
// change it themselves.

export type OutreachStatus =
  | "not_contacted"
  | "initial_outreach_sent"
  | "follow_up_sent"
  | "responded"
  | "converted"
  | "future_potential"
  | "soft_no"
  | "hard_no"
  | "no_response"
  | "loss_due_timing";

const MANUAL_TERMINAL_STATUSES: ReadonlySet<OutreachStatus> = new Set([
  "converted",
  "future_potential",
  "soft_no",
  "hard_no",
  "no_response",
  "loss_due_timing",
]);

export function shouldTransitionToResponded(
  currentStatus: OutreachStatus,
): boolean {
  if (currentStatus === "responded") return false;
  return !MANUAL_TERMINAL_STATUSES.has(currentStatus);
}
