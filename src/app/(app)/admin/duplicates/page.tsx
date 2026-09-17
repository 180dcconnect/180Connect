// F042 — Possible duplicate charities.
//
// The import pipeline holds a register record here instead of adding it when it
// looks like a charity already on the client list: the same registration number,
// or the same name and postcode. Somebody has to say which it is, and until they
// do the record is on neither list.
//
// ── The layout ──
//
// Rebuilt on the app's own system (docs/app-design-system.md) with the Data
// imports screens as the structure reference, which is what the page below is:
//
//   1. A heading and one line saying what a decision does — the page has exactly
//      two answers, and which one an admin picks changes whether a client is
//      created.
//   2. A rail under it (the register rail's shape, minus the button) answering
//      the question people arrive with: is anything waiting?
//   3. The flagged pairs — each one the two records side by side — then what has
//      already been decided.
//
// It was one white card on `#f1f2f4` with an uppercase micro-label per field, a
// five-column history table, and Tailwind ramp colours borrowed from three other
// screens. The pairs themselves were right; nothing around them said what they
// meant.
//
// ── What a viewer sees ──
//
// Nothing, and now the page says so. Leadership reaches this screen (F042 is
// gated on `approval:manage`, which `canView` opens to a viewer) but the queue
// itself is admin-only at the database: a flag is a join onto the raw payload an
// import stored, and RAW_SOURCE_RECORDS and ENTITY_MATCH_CANDIDATES are both
// admin-only (20260810120000). RLS answers a forbidden read with an empty list,
// so a viewer was shown the empty-state copy — "nothing has been held for a
// duplicate check yet" — about a queue they cannot read. The page now skips
// reads that can only return nothing and says why instead, in the same voice as
// the rest of the screen.
//
// The root element is a `div`, not a `main`: the admin layout's AppShell already
// renders the `main` this is slotted into.

import { redirect } from "next/navigation";

import { getViewingActor } from "@/lib/auth/actor";
import { adminRouteDestination } from "@/lib/auth/admin-route";
import { hasPermission, isViewOnly } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { reportError } from "@/lib/error-logging";
import {
  DECIDED_LIMIT,
  ENTITY_MATCH_CANDIDATE_SELECT,
  PENDING_LIMIT,
  toPendingReview,
  toQueueRecord,
  type EntityMatchCandidateRow,
} from "@/lib/duplicates";
import { Group, Rise, Stage } from "@/components/dashboard-stage";
import { InlineAlert } from "@/components/ui/inline-alert";
import { DuplicatesPanel } from "./duplicates-panel";

/**
 * Is anything waiting, in one line.
 *
 * The same rail the Data imports screens carry under their heading
 * (register-rail.tsx), reduced to what this page has: the queue's state. A dot
 * carries the state as well as the words do, so it survives a glance — amber
 * when there is work, green when the queue is clear.
 *
 * Nothing renders until something has been flagged at least once: on a first
 * visit the panel below already explains what the queue is for, and a line
 * above it repeating that would be the same sentence twice.
 *
 * The pending read is bounded (`PENDING_LIMIT`), so a full window is reported as
 * "200+" rather than as a number nobody can stand behind: the true count may be
 * higher, and a figure that quietly understates the queue would be worse than no
 * figure. Same reasoning as the counts on the Import status page.
 */
function QueueRail({
  pending,
  decided,
}: {
  pending: number;
  decided: number;
}) {
  if (pending === 0 && decided === 0) return null;

  const capped = pending >= PENDING_LIMIT;

  return (
    <p className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 font-body text-sm text-dim">
      <span
        aria-hidden="true"
        className={`size-1.5 shrink-0 rounded-full ${pending > 0 ? "bg-hold" : "bg-go"}`}
      />
      {pending > 0 ? (
        <>
          <span className="font-semibold tabular-nums text-ink">
            {pending.toLocaleString()}
            {capped ? "+" : ""}
          </span>
          {pending === 1 && !capped ? "charity is" : "charities are"} waiting for a
          decision
        </>
      ) : (
        <>
          Nothing is waiting for a decision ·{" "}
          <span className="font-semibold tabular-nums text-ink">
            {decided.toLocaleString()}
          </span>{" "}
          already decided
        </>
      )}
    </p>
  );
}

export default async function DuplicatesPage() {
  const authorization = await getViewingActor("approval:manage", {
    route: "/admin/duplicates",
  });
  if (!authorization.ok) redirect(adminRouteDestination(authorization.reason));

  // Leadership reads every pair and answers none of them. This asks the same
  // question the panel's PATCH route asks (`approval:manage`), never the role —
  // so the two cannot drift apart the day the permission moves.
  const canDecide = hasPermission(authorization.actor.role, "approval:manage");

  // A viewer reads nothing from this queue, and that is the database's decision,
  // not this page's: ENTITY_MATCH_CANDIDATES and RAW_SOURCE_RECORDS are both
  // admin-only at RLS (20260810120000), because a flag is a join onto the raw
  // payload an import stored. Row-level security answers with an empty list
  // rather than an error, so a viewer used to be shown "nothing has been held for
  // a duplicate check yet" — a statement about a queue they cannot read. The
  // reads are skipped for the same reason: they can only return nothing.
  const viewOnly = isViewOnly(authorization.actor.role);

  const supabase = await createClient();

  // The queue an admin acts on is the pending set; decided rows are history.
  // Bounds come from `@/lib/duplicates` so this read and the panel's refresh
  // cannot end up showing different windows.
  const [pendingResult, decidedResult] = viewOnly
    ? [null, null]
    : await Promise.all([
        supabase
          .from("entity_match_candidates")
          .select(ENTITY_MATCH_CANDIDATE_SELECT)
          .eq("match_status", "pending")
          .order("created_at", { ascending: false })
          .limit(PENDING_LIMIT)
          .overrideTypes<EntityMatchCandidateRow[], { merge: false }>(),
        supabase
          .from("entity_match_candidates")
          .select(ENTITY_MATCH_CANDIDATE_SELECT)
          .neq("match_status", "pending")
          .order("created_at", { ascending: false })
          .limit(DECIDED_LIMIT)
          .overrideTypes<EntityMatchCandidateRow[], { merge: false }>(),
      ]);

  const pendingError = pendingResult?.error ?? null;
  const decidedError = decidedResult?.error ?? null;

  if (pendingError) {
    await reportError(pendingError, { operation: "admin.duplicates.page_list_pending" });
  }
  if (decidedError) {
    await reportError(decidedError, { operation: "admin.duplicates.page_list_decided" });
  }

  const pending = pendingResult?.data ?? [];
  const decided = decidedResult?.data ?? [];

  // Both sides of every pending pair are read here, on the server: the register
  // payload needs the source mappers, and the client's side needs its identifiers
  // and filed financials. The panel renders what it is given.
  const pendingReviews = pending.map(toPendingReview);
  const decidedRecords = decided.map(toQueueRecord);

  return (
    <div className="min-h-screen bg-[#f4f4ef] px-6 py-10 sm:px-10 sm:py-12">
      {/* No max-w-*: content fills the column and the page's side padding sets
          where it stops (docs/app-design-system.md §Width). */}
      <Stage className="w-full space-y-8">
        <Rise>
          <h1 className="font-body text-[clamp(2rem,4vw,2.75rem)] leading-[1] font-semibold tracking-[-0.03em] text-ink">
            Possible duplicate charities
          </h1>
          <p className="mt-3 text-sm leading-[1.7] text-dim">
            {canDecide ? (
              <>
                When a charity arriving from the register looks like one already
                on the client list — the same registration number, or the same
                name and postcode — it is held here instead of being added. Each
                pair shows the register&rsquo;s copy of the record beside the
                client&rsquo;s, with the fields the two disagree on marked, so the answer comes
                from the two records rather than from the name alone. Keeping one
                record asks you to pick the winning value for every detail the two
                disagree on — starting with what&rsquo;s already on the client — and saves
                your picks with the decision; calling them different charities
                adds the new one as its own client when the importer next runs.
              </>
            ) : (
              <>
                When a charity arriving from the register looks like one already
                on the client list — the same registration number, or the same
                name and postcode — it is held here instead of being added, and
                an administrator decides whether the two are one charity.
              </>
            )}
          </p>
          {!viewOnly && <QueueRail pending={pending.length} decided={decided.length} />}
        </Rise>

        <Group>
          {viewOnly ? (
            <Rise>
              <p className="rounded-panel border border-dashed border-rule bg-white px-5 py-6 font-body text-sm leading-[1.65] text-dim">
                Each pair carries the register&rsquo;s raw copy of an incoming record, and the
                database shows those to administrators only. Your access is view-only, so nothing
                here needs an answer from you.
              </p>
            </Rise>
          ) : (
            <>
              <Rise>
                {(pendingError || decidedError) && (
                  <InlineAlert
                    variant="page"
                    message="The queue could not be loaded. This has been recorded — refresh and try again."
                  />
                )}
              </Rise>
              <Rise>
                <DuplicatesPanel
                  initialPending={pendingReviews}
                  initialDecided={decidedRecords}
                  canDecide={canDecide}
                  decidedLimit={DECIDED_LIMIT}
                />
              </Rise>
            </>
          )}
        </Group>
      </Stage>
    </div>
  );
}
