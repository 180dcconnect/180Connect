import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireApprovedUser } from "@/lib/auth/require-approved-user";
import { logSecurityEvent } from "@/lib/log-security-event";
import { getCurrentActor } from "@/lib/auth/actor";
import Link from "next/link";
import { logout } from "./actions";

export default async function DashboardPage() {
  let user;

  try {
    const supabase = await createClient();
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

  const actorResult = await getCurrentActor();
  if (!actorResult.ok) {
    logSecurityEvent("permission.denied", {
      route: "/dashboard",
      reason: actorResult.reason,
    });
    redirect("/login");
  }
  const actor = actorResult.actor;

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f1f2f4] p-6">
      <section className="w-full max-w-xl rounded-2xl bg-white p-8 shadow-sm">
        <p className="text-sm font-bold text-brand">180Connect</p>
        <h1 className="mt-2 text-2xl font-bold">Dashboard</h1>
        <p className="mt-3 text-sm text-foreground/65">
          You are securely logged in as {user.email}.
        </p>
        <p className="mt-2 text-sm font-bold uppercase tracking-wide text-foreground/60">
          Role: {actor.role}
        </p>
        {actor.role === "admin" && (
          <nav className="mt-6 grid gap-2 sm:grid-cols-2" aria-label="Admin tools">
            <Link className="rounded-xl border border-brand/40 p-3 font-bold text-brand hover:bg-brand/5" href="/admin">
              Admin workspace
            </Link>
            <Link className="rounded-xl border border-brand/40 p-3 font-bold text-brand hover:bg-brand/5" href="/admin#approvals">
              Approvals
            </Link>
            <Link className="rounded-xl border border-brand/40 p-3 font-bold text-brand hover:bg-brand/5" href="/admin#team-pipeline">
              Team Pipeline View
            </Link>
          </nav>
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
