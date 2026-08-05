import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireApprovedUser } from "@/lib/auth/require-approved-user";
import { logSecurityEvent } from "@/lib/log-security-event";
import { getCurrentActor } from "@/lib/auth/actor";
import { hasPermission } from "@/lib/auth/permissions";
import { navItemsFor } from "@/lib/nav";
import Link from "next/link";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
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

  // F258: a read-only account is told so up front, rather than discovering it by
  // pressing a button that fails. "May this role write?" is exactly "does it hold a
  // write permission" — client:edit stands in for the whole write set (a viewer has
  // only client:view). No write affordances live on this page yet to hide; when they
  // do, gate them the same way and keep the server-side check regardless.
  const canWrite = hasPermission(actor.role, "client:edit");

  // Every destination this role can actually reach, from the one nav list. No
  // placeholder tiles: a role with nothing built for it yet is told so plainly.
  const navItems = navItemsFor(actor.role);

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
        {error === "admin-access-required" && (
          <p className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm font-bold text-red-800" role="alert">
            That page is restricted to administrators.
          </p>
        )}
        {!canWrite && (
          <p className="mt-4 rounded-lg bg-black/5 px-4 py-3 text-sm text-foreground/75">
            Your account has read-only access. You can view client records and team
            activity, but not create, edit, or send anything.
          </p>
        )}
        {navItems.length > 0 ? (
          <nav className="mt-6 grid gap-3" aria-label="Your workspace">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-xl border border-brand/40 p-4 hover:bg-brand/5"
              >
                <span className="font-bold text-brand">{item.label}</span>
                <span className="mt-1 block text-sm text-foreground/65">
                  {item.description}
                </span>
              </Link>
            ))}
          </nav>
        ) : (
          <p className="mt-6 rounded-xl border border-black/10 p-4 text-sm text-foreground/65">
            No workspace tools are available for your role yet. Client records and
            reporting will appear here as they are released.
          </p>
        )}
      </section>
    </main>
  );
}
