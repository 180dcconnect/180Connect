import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getViewingActor } from "@/lib/auth/actor";
import { isViewOnly } from "@/lib/auth/permissions";
import { adminRouteDestination } from "@/lib/auth/admin-route";
import { reportError } from "@/lib/error-logging";
import { formatMyActions, type ActionRow } from "@/lib/actions";
import { Group, Rise, Stage } from "@/components/dashboard-stage";
import { InlineAlert } from "@/components/ui/inline-alert";
import { ActionsHeader } from "./actions-header";
import { ActionsList } from "./actions-list";

/**
 * F168 — My Actions Tab: every open ACTIONS row assigned to the signed-in
 * user, whoever/whatever put it there, each linking to its client, completed
 * work excluded from this default view. Wrapped in the AppShell by
 * ./layout.tsx, like every other signed-in route.
 *
 * AC3 is enforced in the query itself — `status = 'open'`, the filter
 * actions_assignee_status_idx (assignee_user_id, status) was created for —
 * and repeated defensively in formatMyActions, matching the codebase's
 * "don't trust the query alone" convention (see @/lib/actions). The
 * created_at order is the deterministic tie-break the client-side due-date
 * sort's "oldest-created-first" behaviour relies on.
 *
 * F170 — Action Due Dates: grouped by urgency (overdue first, then
 * upcoming, then undated) rather than one flat feed; "no due date" gets its
 * own visible section. See @/lib/actions's groupMyActionsByDueDate.
 *
 * F171 — Mark Action Complete: each row offers "Mark complete" directly
 * (complete-action-button.tsx -> actions.ts's completeActionAction ->
 * complete_action RPC). AC2's "removed from the default view" is not special
 * logic here — it falls straight out of formatMyActions' existing
 * status='open' filter the moment the RPC flips the row, and the Server
 * Action's revalidatePath makes the very next render of this page reflect
 * it. AC2's "keeps a record... for audit purposes (F221)" and AC3's "shows
 * who completed it and when" are both satisfied without new UI in this
 * ticket: complete_action writes an `action_completed` audit_log row in the
 * same transaction, and F221's existing, generic /admin/audit-log page
 * already renders any audit_log row it doesn't need to know about in
 * advance — see that RPC's migration header.
 *
 * `assignee_user_id` is what "my" means here — not `created_by_user_id`
 * (who raised the action, shown per-row instead; see ActionOrigin). RLS
 * (actions_select_active, matrix §3.11) already shares read across every
 * active role, but the assignee filter is what actually makes this "my"
 * queue rather than the whole team's.
 *
 * `client:view` gates the route — a personal work queue over client data
 * needs no narrower permission than the data itself.
 */
export default async function ActionsPage() {
  const authorization = await getViewingActor("client:view", { route: "/actions" });
  if (!authorization.ok) redirect(adminRouteDestination(authorization.reason));

  // Leadership has no queue of its own — an action is always assigned to whoever
  // does the work, and a viewer never does. Rather than show them a page that
  // can only ever be empty, send them to the whole team's actions, which is what
  // their sidebar row and `actionsTabsFor` already point at.
  if (isViewOnly(authorization.actor.role)) redirect("/admin/actions");

  const supabase = await createClient();

  const { data: actionRows, error: actionsError } = await supabase
    .from("actions")
    .select(
      "id, title, description, due_date, status, priority, organisation_id, created_by_user_id, created_at, " +
        "organisation:organisations!actions_organisation_id_fkey(legal_name), " +
        "created_by_user:users!actions_created_by_user_id_fkey(full_name)",
    )
    .eq("assignee_user_id", authorization.actor.id)
    .eq("status", "open")
    .order("created_at", { ascending: true });

  if (actionsError) {
    await reportError(actionsError, {
      operation: "actions.my_actions",
      userId: authorization.actor.id,
    });
  }

  const actions = formatMyActions(
    (actionRows ?? []) as unknown as ActionRow[],
    authorization.actor.id,
  );
  return (
    <div className="min-h-screen max-w-full overflow-x-hidden bg-[#f4f4ef] px-4 py-8 sm:px-8 sm:py-10 xl:px-12 xl:py-12">
      <Stage className="mx-auto w-full max-w-[1400px] space-y-6">
        <Rise>
          <ActionsHeader current="/actions">
            <p className="mt-3 font-body text-sm leading-[1.7] text-dim">
              Outstanding work assigned to you, overdue first. Mark a task complete to
              remove it from this list — it stays on record.
            </p>
          </ActionsHeader>
        </Rise>

        <Group>
          <Rise>
            {actionsError ? (
              <InlineAlert
                variant="page"
                message="Your tasks could not be loaded. Refresh and try again."
              />
            ) : (
              <ActionsList actions={actions} />
            )}
          </Rise>
        </Group>
      </Stage>
    </div>
  );
}
