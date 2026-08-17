import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentActor } from "@/lib/auth/actor";
import { adminRouteDestination } from "@/lib/auth/admin-route";
import { createClient } from "@/lib/supabase/server";
import { reportError } from "@/lib/error-logging";
import type { PendingInvite } from "@/lib/admin/team-realtime";
import { TeamPanel } from "./team-panel";
import type { TeamUser } from "./user-management-table";
import { Stage, Rise } from "@/components/dashboard-stage";
import { InviteDialog } from "./invite-dialog";

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
    .select("id, email, full_name, role, is_active, deactivated_at, last_seen_at")
    .or("invited_at.is.null,invite_accepted_at.not.is.null")
    .order("full_name");

  if (error) {
    await reportError(error, { operation: "admin.users.page_list" });
  }

  const { data: pendingInvites, error: pendingError } = await supabase
    .from("users")
    .select("id, email, invited_at, role")
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
    <div className="min-h-screen bg-[#f4f4ef] px-6 py-10 sm:px-10 sm:py-12">
      <Stage className="mx-auto w-full max-w-6xl space-y-10">
        <Rise className="flex flex-wrap items-end justify-between gap-x-8 gap-y-5">
          <div className="min-w-0">
            <h1 className="text-[clamp(2rem,4vw,2.75rem)] font-black leading-[1] tracking-[-0.03em]">Team members</h1>
            <p className="mt-3 text-sm text-foreground/65">
              Role changes apply on the user&apos;s next request.{" "}
              <Link className="font-bold text-brand underline" href="/admin/offboard">
                Reassign a leaver&apos;s clients
              </Link>
              .
            </p>
          </div>
          <InviteDialog />
        </Rise>

        {error && (
          <Rise>
            <p className="rounded-2xl border border-destructive/20 bg-destructive/[0.06] px-5 py-4 text-sm font-bold text-destructive" role="alert">
              Team members could not be loaded. Please refresh and try again.
            </p>
          </Rise>
        )}

        <TeamPanel
          currentUserId={authorization.actor.id}
          initialPendingInvites={(pendingInvites as PendingInvite[] | null) ?? []}
          initialTeamUsers={teamUsers}
          pendingInvitesError={Boolean(pendingError)}
        />
      </Stage>
    </div>
  );
}
