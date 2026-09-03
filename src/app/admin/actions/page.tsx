import { redirect } from "next/navigation";
import { getCurrentActor } from "@/lib/auth/actor";
import { adminRouteDestination } from "@/lib/auth/admin-route";
import { reportError } from "@/lib/error-logging";
import { createClient } from "@/lib/supabase/server";
import { AssignActionPanel } from "./assign-action-panel";

const ACTION_SELECT =
  "id, title, description, due_date, status, organisation_id, created_by_user_id, assignee_user_id, created_at, " +
  "organisation:organisations!actions_organisation_id_fkey(legal_name), " +
  "created_by_user:users!actions_created_by_user_id_fkey(full_name), " +
  "assignee:users!actions_assignee_user_id_fkey(full_name)";

/**
 * F169 — Admin-Assigned Actions. An admin creates a client-linked action and
 * hands it to a specific CAM (AC1); it appears in that CAM's own Actions tab
 * (/actions, F168) the moment they next load it — a plain server render, no
 * "accept" step, no realtime plumbing needed (AC2). This page is the
 * team-wide half: everyone's admin-assigned work, outstanding separated from
 * completed (AC3) — see AssignActionPanel.
 *
 * `user:manage` gates this the same way /admin and /admin/users do — F169's
 * own dependency note calls it "useful team management", and every admin
 * capability already sits behind that permission.
 *
 * Client and CAM pickers are fetched here rather than in the panel so the
 * form has real options on first paint, same shape as AssignOwnerForm's
 * `team` prop on the client profile page.
 */
export default async function AdminActionsPage() {
  const authorization = await getCurrentActor("user:manage", { route: "/admin/actions" });
  if (!authorization.ok) redirect(adminRouteDestination(authorization.reason));

  const supabase = await createClient();

  const [actionsResult, teamResult, clientsResult] = await Promise.all([
    supabase.from("actions").select(ACTION_SELECT).order("created_at", { ascending: false }),
    supabase
      .from("users")
      .select("id, full_name")
      .eq("role", "cam")
      .eq("is_active", true)
      .order("full_name"),
    // Ordered by name, not paginated — same scale assumption as the other
    // admin pickers on this branch (e.g. AssignOwnerForm's team list); a
    // client-count high enough to need search/pagination here is a later
    // problem, not one this ticket's AC asks to solve.
    supabase.from("organisations").select("id, legal_name").order("legal_name").limit(1000),
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

  return (
    <main className="min-h-screen bg-[#f1f2f4] p-6">
      <section className="mx-auto w-full max-w-4xl rounded-2xl bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-bold">Team actions</h1>
        <p className="mt-3 text-sm text-foreground/65">
          Create a client-linked action and assign it to a CAM. It appears on their own
          Actions tab immediately — nothing for them to accept first. This page shows
          every action assigned this way across the team, outstanding and completed.
        </p>

        {(actionsResult.error || teamResult.error || clientsResult.error) && (
          <p
            className="mt-5 rounded-xl bg-red-50 p-4 text-sm font-bold text-red-800"
            role="alert"
          >
            Some of this page could not be loaded. Refresh and try again.
          </p>
        )}

        <AssignActionPanel
          team={teamResult.data ?? []}
          clients={clientsResult.data ?? []}
          initialActions={actionsResult.data ?? []}
        />
      </section>
    </main>
  );
}
