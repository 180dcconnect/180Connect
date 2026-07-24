import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireApprovedUser } from "@/lib/auth/require-approved-user";
import { canWrite, fetchUserRole, isAdmin, type UserRole } from "@/lib/auth/roles";
import { logSecurityEvent } from "@/lib/log-security-event";
import { logout } from "./actions";

const ROLE_LABEL: Record<UserRole, string> = {
  admin: "Admin",
  cam: "CAM",
  viewer: "Viewer (read-only)",
};

export default async function DashboardPage() {
  let user;
  let supabase;

  try {
    supabase = await createClient();
    const result = await supabase.auth.getUser();
    user = result.data.user;
  } catch {
    redirect("/login");
  }

  if (!user) {
    redirect("/login");
  }

  const permission = requireApprovedUser(user);
  if (!permission.ok) {
    logSecurityEvent("permission.denied", {
      route: "/dashboard",
      reason: permission.reason,
    });
    redirect("/login");
  }

  // Read per request, never from the JWT: F016 AC4 requires a role change to take
  // effect on the next request without the user logging out, and a token claim
  // would stay stale until it expired.
  const role = await fetchUserRole(supabase, user.id);

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f1f2f4] p-6">
      <section className="w-full max-w-xl rounded-2xl bg-white p-8 shadow-sm">
        <p className="text-sm font-bold text-brand">180Connect</p>
        <h1 className="mt-2 text-2xl font-bold">Dashboard</h1>
        <p className="mt-3 text-sm text-foreground/65">
          You are securely logged in as {user.email}
          {role ? ` — ${ROLE_LABEL[role]}` : ""}.
        </p>

        {/*
          F258 AC4: a viewer is told what their access is up front, rather than
          discovering it by pressing a button that fails. There are no write
          affordances on this page yet to hide — when there are, gate them on
          canWrite(role) and keep the server-side check in the action regardless.
        */}
        {!canWrite(role) && (
          <p className="mt-4 rounded-lg bg-black/5 px-4 py-3 text-sm text-foreground/75">
            Your account has read-only access. You can view client records and team
            activity, but not create, edit, or send anything.
          </p>
        )}

        {isAdmin(role) && (
          <p className="mt-4 rounded-lg bg-black/5 px-4 py-3 text-sm text-foreground/75">
            You have admin access: user management, approvals, and ownership
            reassignment.
          </p>
        )}

        <form action={logout} className="mt-8">
          <button type="submit" className="rounded-full border border-black/10 px-5 py-2 text-sm font-bold hover:bg-black/5">
            Log out
          </button>
        </form>
      </section>
    </main>
  );
}
