import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentActor } from "@/lib/auth/actor";
import { adminRouteDestination } from "@/lib/auth/admin-route";
import { createClient } from "@/lib/supabase/server";
import { reportError } from "@/lib/error-logging";
import type { PendingInvite } from "@/lib/admin/team-realtime";
import { TeamPanel } from "./team-panel";
import type { TeamUser } from "./user-management-table";

export default async function AdminUsersPage() {
  const authorization = await getCurrentActor("user:manage", {
    route: "/admin/users",
  });
  if (!authorization.ok) redirect(adminRouteDestination(authorization.reason));

  const supabase = await createClient();

  // Excludes rows with an invite still pending (invited_at set, not yet
  // accepted) — those are listed separately below, not mixed into the team
  // table, so the two lists stay mutually exclusive (F008 AC5).
  const { data: users, error } = await supabase
    .from("users")
    .select("id, email, full_name, role, is_active, deactivated_at")
    .or("invited_at.is.null,invite_accepted_at.not.is.null")
    .order("full_name");

  if (error) {
    await reportError(error, { operation: "admin.users.page_list" });
  }

  const { data: pendingInvites, error: pendingError } = await supabase
    .from("users")
    .select("id, email, invited_at")
    .not("invited_at", "is", null)
    .is("invite_accepted_at", null)
    .order("invited_at", { ascending: false });

  if (pendingError) {
    await reportError(pendingError, { operation: "admin.users.pending_invites_list" });
  }

  // Owned-client counts drive the reassignment gate's warning (F014 AC2), so the admin
  // sees "owns 3 clients" before starting rather than being refused after. Fetched
  // separately because PostgREST cannot aggregate across the reverse of this FK in one
  // select. A failure here is not fatal: deactivate_user recounts authoritatively.
  const { data: owned, error: ownedError } = await supabase
    .from("organisations")
    .select("owner_id")
    .not("owner_id", "is", null);

  if (ownedError) {
    await reportError(ownedError, { operation: "admin.users.page_owned_counts" });
  }

  const ownedCounts = new Map<string, number>();
  for (const row of owned ?? []) {
    if (!row.owner_id) continue;
    ownedCounts.set(row.owner_id, (ownedCounts.get(row.owner_id) ?? 0) + 1);
  }

  const teamUsers: TeamUser[] = (users ?? []).map((user) => ({
    ...user,
    owned_client_count: ownedCounts.get(user.id) ?? 0,
  })) as TeamUser[];

  return (
    <main className="min-h-screen bg-[#f1f2f4] p-6">
      <section className="mx-auto max-w-5xl rounded-2xl bg-white p-8 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-bold text-brand">Team management</p>
            <h1 className="mt-2 text-3xl font-bold">Team members</h1>
            <p className="mt-3 text-sm text-foreground/65">
              Role changes apply on the user&apos;s next request.{" "}
              <Link className="font-bold text-brand underline" href="/admin/offboard">
                Reassign a leaver&apos;s clients
              </Link>
              .
            </p>
          </div>
          <Link className="text-sm font-bold text-brand hover:underline" href="/dashboard">
            Back to dashboard
          </Link>
        </div>
        {error && (
          <p className="mt-5 rounded-xl bg-red-50 p-4 text-sm font-bold text-red-800" role="alert">
            Team members could not be loaded. Please refresh and try again.
          </p>
        )}
        <TeamPanel
          currentUserId={authorization.actor.id}
          initialPendingInvites={(pendingInvites as PendingInvite[] | null) ?? []}
          initialTeamUsers={teamUsers}
          pendingInvitesError={Boolean(pendingError)}
        />
      </section>
    </main>
  );
}
