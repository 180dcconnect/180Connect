import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentActor } from "@/lib/auth/actor";
import { adminRouteDestination } from "@/lib/auth/admin-route";
import { reportError } from "@/lib/error-logging";
import { formatMyActions, type ActionRow } from "@/lib/actions";
import { Group, Rise, Stage } from "@/components/dashboard-stage";
import { InlineAlert } from "@/components/ui/inline-alert";
import { ActionsList } from "./actions-list";

/**
 * F168 — My Actions Tab: every open ACTIONS row assigned to the signed-in
 * user, whoever/whatever put it there (AC1), each linking to its client
 * (AC2), completed work excluded from this default view (AC3).
 *
 * `assignee_user_id` is what "my" means here — not `created_by_user_id`
 * (which only tells you who raised the action, shown per-row instead; see
 * @/lib/actions's ActionOrigin). RLS (actions_select_active, matrix §3.11)
 * already shares read across every active role, but the assignee filter is
 * what actually makes this "my" queue rather than the whole team's.
 *
 * `client:view` gates the route (matrix: same permission every role that can
 * see a client profile holds) — a personal work queue over client data needs
 * no narrower permission than the data itself.
 *
 * F169's admin-assigned actions land here for free: an admin creating one
 * through /admin/actions is a plain INSERT (actions_insert_admin), so the
 * very next load of this page — no reload trick, no realtime needed, just an
 * ordinary fresh server render — already shows it (AC2 of F169).
 */
export default async function ActionsPage() {
  const authorization = await getCurrentActor("client:view", { route: "/actions" });
  if (!authorization.ok) redirect(adminRouteDestination(authorization.reason));

  const supabase = await createClient();

  const { data: actionRows, error: actionsError } = await supabase
    .from("actions")
    .select(
      "id, title, description, due_date, status, organisation_id, created_by_user_id, created_at, " +
        "organisation:organisations!actions_organisation_id_fkey(legal_name), " +
        "created_by_user:users!actions_created_by_user_id_fkey(full_name)",
    )
    .eq("assignee_user_id", authorization.actor.id);

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
    <div className="min-h-screen bg-[#f4f4ef] px-6 py-10 sm:px-10 sm:py-12">
      <Stage className="mx-auto w-full max-w-3xl space-y-6">
        <Rise>
          <h1 className="text-[clamp(1.75rem,3.5vw,2.5rem)] font-semibold font-body leading-[1.05] tracking-[-0.03em]">
            My actions
          </h1>
          <p className="mt-2 text-sm leading-[1.7] text-foreground/50">
            Outstanding work assigned to you — system-generated, admin-assigned, or
            your own. Completed actions are not shown here.
          </p>
        </Rise>

        <Group>
          <Rise>
            {actionsError ? (
              <InlineAlert
                variant="page"
                message="Your actions could not be loaded. Refresh and try again."
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
