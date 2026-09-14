/**
 * The four approval queues an admin has to clear, counted.
 *
 * Two screens now read these: the CAM dashboard's Admin Action Center (which
 * only renders for an admin) and the admin dashboard's own duty-queue card.
 * They used to be four inline `count: "exact", head: true` reads written
 * straight into whichever page needed them, and a number that appears on two
 * screens is a number that will disagree with itself the first time somebody
 * adds a filter to one copy. The queries live here once.
 *
 * `unassignedOrgs` is deliberately not counted here. Both callers already hold
 * the organisation rows that number comes from, and a fifth round trip to
 * count what is already in memory is the expensive way to get it wrong.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type AdminQueueTally = {
  pendingSuppressions: number;
  ownershipRequests: number;
  suggestedEdits: number;
  discrepancies: number;
  /** Every queue added up — the "N actions needed" figure. */
  total: number;
};

/**
 * All four counts, or null with the error to report. One failed count fails the
 * whole tally rather than rendering a zero: "0 ownership requests" and "the
 * ownership-request query broke" look identical on screen, and the second one
 * is the one that gets someone to act.
 */
export async function fetchAdminQueueTally(
  supabase: SupabaseClient,
): Promise<{ tally: AdminQueueTally | null; error: { message: string } | null }> {
  const [ownershipRequests, suppressions, edits, discrepancies] = await Promise.all([
    supabase
      .from("ownership_requests")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending"),
    supabase
      .from("suppressions")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending"),
    supabase
      .from("edit_suggestions")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending"),
    supabase
      .from("field_discrepancies")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending"),
  ]);

  const failed = [ownershipRequests, suppressions, edits, discrepancies].find(
    (result) => result.error,
  );
  if (failed?.error) return { tally: null, error: failed.error };

  const counts = {
    ownershipRequests: ownershipRequests.count ?? 0,
    pendingSuppressions: suppressions.count ?? 0,
    suggestedEdits: edits.count ?? 0,
    discrepancies: discrepancies.count ?? 0,
  };

  return {
    tally: {
      ...counts,
      total:
        counts.ownershipRequests +
        counts.pendingSuppressions +
        counts.suggestedEdits +
        counts.discrepancies,
    },
    error: null,
  };
}
