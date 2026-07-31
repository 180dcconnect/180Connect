import { redirect } from "next/navigation";
import { getCurrentActor } from "@/lib/auth/actor";
import { createClient } from "@/lib/supabase/server";
import { reportError } from "@/lib/error-logging";
import { InviteForm } from "./invite-form";
import {
  UserManagementTable,
  type TeamUser,
} from "./user-management-table";

type PendingInvite = { id: string; email: string; invited_at: string };

export default async function AdminUsersPage() {
  const authorization = await getCurrentActor("user:manage");
  if (!authorization.ok) {
    if (authorization.reason === "unauthenticated") redirect("/login");
    redirect("/dashboard?error=admin-access-required");
  }

  const supabase = await createClient();

  // Excludes rows with an invite still pending (invited_at set, not yet
  // accepted) — those are listed separately below, not mixed into the team
  // table, so the two lists stay mutually exclusive (F008 AC5).
  const { data: users, error } = await supabase
    .from("users")
    .select("id, email, full_name, role, is_active")
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

  return (
    <main className="min-h-screen bg-[#f1f2f4] p-6">
      <section className="mx-auto max-w-5xl rounded-2xl bg-white p-8 shadow-sm">
        <p className="text-sm font-bold text-brand">Admin workspace</p>
        <h1 className="mt-2 text-3xl font-bold">Team members</h1>
        <p className="mt-3 text-sm text-foreground/65">
          Role changes apply on the user&apos;s next request.
        </p>
        {error && (
          <p className="mt-5 rounded-xl bg-red-50 p-4 text-sm font-bold text-red-800" role="alert">
            Team members could not be loaded. Please refresh and try again.
          </p>
        )}
        <UserManagementTable
          currentUserId={authorization.actor.id}
          initialUsers={(users ?? []) as TeamUser[]}
        />

        <hr className="my-8 border-black/10" />

        <h2 className="text-xl font-bold">Invite a CAM</h2>
        <InviteForm />

        <h2 className="mt-8 text-xl font-bold">Pending invites</h2>
        {pendingError ? (
          <p className="mt-3 rounded-xl bg-red-50 p-4 text-sm font-bold text-red-800" role="alert">
            Pending invites could not be loaded. Please refresh and try again.
          </p>
        ) : (pendingInvites ?? []).length === 0 ? (
          <p className="mt-3 text-sm text-foreground/60">No pending invites.</p>
        ) : (
          <ul className="mt-3 divide-y divide-black/5 text-sm">
            {(pendingInvites as PendingInvite[]).map((invite) => (
              <li key={invite.id} className="flex items-center justify-between py-2">
                <span className="font-bold">{invite.email}</span>
                <span className="text-foreground/60">
                  Invited {new Date(invite.invited_at).toLocaleDateString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
