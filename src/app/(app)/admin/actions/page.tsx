import { redirect } from "next/navigation";
import { getViewingActor } from "@/lib/auth/actor";
import { adminRouteDestination } from "@/lib/auth/admin-route";
import { isViewOnly } from "@/lib/auth/permissions";
import { reportError } from "@/lib/error-logging";
import { createClient } from "@/lib/supabase/server";
import { fetchPaged } from "@/lib/supabase/fetch-paged";
import { type TeamActionRow } from "@/lib/actions";
import { Group, Rise, Stage } from "@/components/dashboard-stage";
import { InlineAlert } from "@/components/ui/inline-alert";
import { ActionsHeader } from "../../actions/actions-header";
import { AssignActionPanel } from "./assign-action-panel";

/**
 * What the client picker needs: a name to list and search, and the owner so the
 * form can say when the person being assigned isn't the one who owns the
 * client. Override types explicitly — supabase-js infers an embedded owner as
 * an array, which is neither what PostgREST returns nor what the picker reads
 * (same `.overrideTypes` as the admin analytics page's org read).
 */
type ClientPickerRow = {
  id: string;
  legal_name: string;
  owner_id: string | null;
  owner: { full_name: string | null } | null;
};

const ACTION_SELECT =
  "id, title, description, due_date, status, organisation_id, created_by_user_id, assignee_user_id, created_at, " +
  "organisation:organisations!actions_organisation_id_fkey(legal_name), " +
  "created_by_user:users!actions_created_by_user_id_fkey(full_name), " +
  "assignee:users!actions_assignee_user_id_fkey(full_name)";

/**
 * F169 — Admin-Assigned Actions. An admin creates a client-linked action and
 * hands it to a specific team member — an active CAM or admin (AC1); it
 * appears in that person's own Actions tab (/actions, F168) the moment they
 * next load it — a plain server render, no "accept" step, no realtime
 * plumbing needed (AC2). This page is the team-wide half: everyone's
 * admin-assigned work, outstanding separated from completed (AC3) — see
 * AssignActionPanel.
 *
 * `user:manage` gates this the same way /admin and /admin/users do — F169's
 * own dependency note calls it "useful team management", and every admin
 * capability already sits behind that permission.
 *
 * Client and team pickers are fetched here rather than in the panel so the
 * form has real options on first paint, same shape as AssignOwnerForm's
 * `team` prop on the client profile page.
 */
export default async function AdminActionsPage() {
  const authorization = await getViewingActor("user:manage", { route: "/admin/actions" });
  if (!authorization.ok) redirect(adminRouteDestination(authorization.reason));

  const supabase = await createClient();

  // Leadership (viewer) watches the team's work and hands none of it out: they
  // get the outstanding and completed lists, not the assign form. The two
  // picker reads exist only to fill that form, so for them they are skipped
  // rather than fetched and discarded.
  const canAssign = !isViewOnly(authorization.actor.role);
  const empty = <T,>(): Promise<{ data: T[]; error: null }> =>
    Promise.resolve({ data: [], error: null });

  const [actionsResult, teamResult, clientsResult] = await Promise.all([
    supabase
      .from("actions")
      .select(ACTION_SELECT)
      .order("created_at", { ascending: false })
      .overrideTypes<TeamActionRow[], { merge: false }>(),
    canAssign
      ? supabase
          .from("users")
          .select("id, full_name, role, email")
          .in("role", ["cam", "admin"])
          .eq("is_active", true)
          .order("full_name")
      : empty<{ id: string; full_name: string | null; role: string | null; email: string | null }>(),
    // Every client, not the first thousand alphabetically: the picker's search
    // must cover the whole list or it silently hides clients. A handful of
    // narrow columns ordered by name, walked past PostgREST's row cap with
    // fetchPaged (the admin analytics page's pattern) — small payload, one
    // extra read. The owner join backs the picker's "doesn't own this client"
    // note, and nothing else here reads it.
    canAssign
      ? fetchPaged<ClientPickerRow>((from, to) =>
          supabase
            .from("organisations")
            .select("id, legal_name, owner_id, owner:users!organisations_owner_id_fkey(full_name)")
            .order("legal_name")
            .order("id")
            .range(from, to)
            .overrideTypes<ClientPickerRow[], { merge: false }>(),
        )
      : empty<ClientPickerRow>(),
  ]);

  if (actionsResult.error) {
    await reportError(actionsResult.error, { operation: "admin.actions.page_list" });
  }
  if (teamResult.error) {
    await reportError(teamResult.error, { operation: "admin.actions.page_team" });
  }
  if (clientsResult.error) {
    await reportError(clientsResult.error, { operation: "admin.actions.page_clients" });
  }

  // The root element is a `div`, not a `main`: the admin layout's AppShell
  // already renders the `main` this is slotted into.
  return (
    <div className="min-h-screen bg-[#f4f4ef] px-6 py-10 sm:px-10 sm:py-12">
      <Stage className="mx-auto w-full max-w-4xl space-y-8">
        <Rise>
          <ActionsHeader current="/admin/actions">
            <p className="mt-3 max-w-xl text-sm leading-[1.7] text-foreground/65">
              {canAssign
                ? "Give a team member a piece of client work. It appears on their Actions tab straight away — nothing for them to accept first."
                : "Every piece of client work the team has been given, outstanding and completed."}
            </p>
          </ActionsHeader>
        </Rise>

        <Group>
          <Rise>
            {(actionsResult.error || teamResult.error || clientsResult.error) && (
              <InlineAlert
                variant="page"
                message="Some of this page could not be loaded. This has been recorded — refresh and try again."
              />
            )}
          </Rise>
          <Rise>
            <AssignActionPanel
              team={teamResult.data ?? []}
              clients={clientsResult.data ?? []}
              initialActions={actionsResult.data ?? []}
              canAssign={canAssign}
            />
          </Rise>
        </Group>
      </Stage>
    </div>
  );
}
