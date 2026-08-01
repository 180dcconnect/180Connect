import { redirect } from "next/navigation";
import { getCurrentActor } from "@/lib/auth/actor";
import { createClient } from "@/lib/supabase/server";
import { reportError } from "@/lib/error-logging";
import {
  UserManagementTable,
  type TeamUser,
} from "./user-management-table";

export default async function AdminUsersPage() {
  const authorization = await getCurrentActor("user:manage");
  if (!authorization.ok) {
    if (authorization.reason === "unauthenticated") redirect("/login");
    redirect("/dashboard?error=admin-access-required");
  }

  const supabase = await createClient();
  const { data: users, error } = await supabase
    .from("users")
    .select("id, email, full_name, role, is_active")
    .order("full_name");

  if (error) {
    await reportError(error, { operation: "admin.users.page_list" });
  }

  return (
    <main className="min-h-screen bg-[#f1f2f4] p-6">
      <section className="mx-auto max-w-5xl rounded-2xl bg-white p-8 shadow-sm">
        <p className="text-sm font-bold text-brand">Admin workspace</p>
        <h1 className="mt-2 text-3xl font-bold">Team members</h1>
        <p className="mt-3 text-sm text-foreground/65">
          Role changes apply on the user&apos;s next request.{" "}
          <a className="font-bold text-brand underline" href="/admin/offboard">
            Reassign a leaver&apos;s clients
          </a>
          .
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
      </section>
    </main>
  );
}
