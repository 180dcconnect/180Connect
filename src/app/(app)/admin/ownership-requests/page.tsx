// #408 — Ownership requests.
//
// A CAM cannot take a client another CAM owns — they ask, and an admin decides.
// This queue is that ask. Approving moves the client through reassign_ownership
// inside decide_ownership_request, so the handover is audited the same way
// F163's assign form is.
//
// ── The layout ──
//
// Rebuilt on the app's own system (docs/app-design-system.md), with the Data
// imports screens as the structure reference and the duplicates queue as its
// nearest sibling:
//
//   1. A heading and one line saying what a decision does — the page has
//      exactly two answers, and which one an admin picks changes who owns a
//      client.
//   2. A rail under it (the register rail's shape, minus the button) answering
//      the question people arrive with: is anything waiting?
//   3. The queue, then the history, as tabs — the decisions are read far more
//      often than they are made, so the two are siblings rather than one list
//      with the other stacked underneath.
//
// It was one white card on the stale `#f1f2f4` ground with a bold-everything
// panel inside it. The decisions themselves were right; nothing around them
// said what they meant.
//
// ── What a viewer sees ──
//
// Everything an admin reads — the queue, the counts, the history — and none of
// the controls. `canDecide` asks the same permission the PATCH route behind the
// buttons asks (`approval:manage`), so a button that can only refuse is never
// drawn; where a control would have been, the panel says so in one voice
// (VIEW_ONLY_CONTROL_NOTE).
//
// The root element is a `div`, not a `main`: the admin layout's AppShell
// already renders the `main` this is slotted into.

import { redirect } from "next/navigation";

import { getViewingActor } from "@/lib/auth/actor";
import { adminRouteDestination } from "@/lib/auth/admin-route";
import { hasPermission, isViewOnly } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { reportError } from "@/lib/error-logging";
import { OWNERSHIP_REQUEST_SELECT, type OwnershipRequestRow } from "@/lib/ownership-requests";
import { Group, Rise, Stage } from "@/components/dashboard-stage";
import { InlineAlert } from "@/components/ui/inline-alert";
import { VIEW_ONLY_CONTROL_NOTE } from "@/lib/auth/view-only";
import { OwnershipRequestsPanel } from "./ownership-requests-panel";

/** How many decided requests the page carries — history, not the whole book. */
const DECIDED_LIMIT = 100;

/**
 * Is anything waiting, in one line. The duplicates queue's rail: a dot carries
 * the state as well as the words do — amber when a CAM is waiting on an
 * answer, green when the queue is clear.
 */
function QueueRail({ pending, decided }: { pending: number; decided: number }) {
  return (
    <p className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 font-body text-sm text-dim">
      <span
        aria-hidden="true"
        className={`size-1.5 shrink-0 rounded-full ${pending > 0 ? "bg-hold" : "bg-go"}`}
      />
      {pending > 0 ? (
        <>
          <span className="font-semibold tabular-nums text-ink">
            {pending.toLocaleString("en-GB")}
          </span>
          {pending === 1 ? "client is" : "clients are"} waiting for a decision
        </>
      ) : (
        <>
          Nothing is waiting for a decision ·{" "}
          <span className="font-semibold tabular-nums text-ink">
            {decided.toLocaleString("en-GB")}
          </span>{" "}
          already decided
        </>
      )}
    </p>
  );
}

export default async function OwnershipRequestsPage() {
  const authorization = await getViewingActor("approval:manage", {
    route: "/admin/ownership-requests",
  });
  if (!authorization.ok) redirect(adminRouteDestination(authorization.reason));

  // Leadership sees who asked for which client and decides none of it. This
  // asks the same question the PATCH route behind the two answers asks
  // (`approval:manage`), never the role — so the literal and the permission
  // cannot drift apart the day the permission moves.
  const canDecide = hasPermission(authorization.actor.role, "approval:manage");
  const viewOnly = isViewOnly(authorization.actor.role);

  const supabase = await createClient();

  // The pending set is the queue an admin works; decided rows are the history
  // the page reads. A viewer keeps both readings — the counts and the outcome
  // of every request — because withholding a number they are entitled to see
  // is the opposite mistake to drawing them a button.
  const [pendingResult, decidedResult] = await Promise.all([
    supabase
      .from("ownership_requests")
      .select(OWNERSHIP_REQUEST_SELECT)
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .overrideTypes<OwnershipRequestRow[], { merge: false }>(),
    supabase
      .from("ownership_requests")
      .select(OWNERSHIP_REQUEST_SELECT)
      .neq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(DECIDED_LIMIT)
      .overrideTypes<OwnershipRequestRow[], { merge: false }>(),
  ]);

  const pendingError = pendingResult.error ?? null;
  const decidedError = decidedResult.error ?? null;

  if (pendingError) {
    await reportError(pendingError, { operation: "admin.ownership_requests.page_list_pending" });
  }
  if (decidedError) {
    await reportError(decidedError, { operation: "admin.ownership_requests.page_list_decided" });
  }

  const pending = pendingResult.data ?? [];
  const decided = decidedResult.data ?? [];

  return (
    <div className="min-h-screen bg-ground px-6 py-10 sm:px-10 sm:py-12">
      {/* No max-w-*: content fills the column and the page's side padding sets
          where it stops (docs/app-design-system.md §Width). */}
      <Stage className="w-full space-y-8">
        <Rise>
          <h1 className="font-body text-[clamp(2rem,4vw,2.75rem)] leading-[1] font-semibold tracking-[-0.03em] text-ink">
            Ownership requests
          </h1>
          <p className="mt-3 text-sm leading-[1.7] text-dim">
            {canDecide ? (
              <>
                A CAM cannot take a client another CAM owns — they ask here
                instead. Approving hands the client over to the CAM who asked,
                along with their open tasks, and records the handover in the
                audit log. Rejecting changes nothing: the client stays with its
                current owner, and the CAM is told.
              </>
            ) : (
              <>
                A CAM cannot take a client another CAM owns — they ask here
                instead, and an administrator decides. Each request shows who
                asked, who decided, and what happened to the client.
              </>
            )}
          </p>
          {viewOnly && (
            <p className="mt-2 text-sm text-dim">{VIEW_ONLY_CONTROL_NOTE}</p>
          )}
          {!viewOnly && !pendingError && !decidedError && (
            <QueueRail pending={pending.length} decided={decided.length} />
          )}
        </Rise>

        <Group>
          {(pendingError || decidedError) && (
            <Rise>
              <InlineAlert
                variant="page"
                message="The requests could not be loaded. This has been recorded — refresh and try again."
              />
            </Rise>
          )}
          <Rise>
            <OwnershipRequestsPanel
              initialPending={pending}
              initialDecided={decided}
              canDecide={canDecide}
            />
          </Rise>
        </Group>
      </Stage>
    </div>
  );
}
