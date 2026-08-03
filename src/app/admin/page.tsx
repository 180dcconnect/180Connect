import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentActor } from "@/lib/auth/actor";

/**
 * `/admin` is a hub of tiles, one per admin workspace that actually exists.
 *
 * It briefly became a straight redirect to `/admin/users`, because team
 * management was the only destination and three of the tiles pointed at
 * features that had not been built. F221 added the audit log, so there is a
 * real choice to make again and the hub earns its place.
 *
 * The rule that made the redirect necessary still stands: a tile for a feature
 * that does not exist is worse than no tile, because the user spends a click
 * finding out. Add a tile here only when its route exists — see the same
 * argument in `src/lib/nav.ts`.
 */
export default async function AdminPage() {
  const authorization = await getCurrentActor("user:manage");
  if (!authorization.ok) {
    if (authorization.reason === "unauthenticated") redirect("/login");
    redirect("/dashboard?error=admin-access-required");
  }

  return (
    <main className="min-h-screen bg-[#f1f2f4] p-6">
      <section className="mx-auto max-w-5xl rounded-2xl bg-white p-8 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-bold text-brand">Admin workspace</p>
            <h1 className="mt-2 text-3xl font-bold">Platform management</h1>
            <p className="mt-3 max-w-2xl text-sm text-foreground/65">
              Manage team access and open privileged workflows. Every admin
              action is checked again on the server.
            </p>
          </div>
          <Link className="text-sm font-bold text-brand hover:underline" href="/dashboard">
            Back to dashboard
          </Link>
        </div>

        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          <Link className="rounded-xl border border-black/10 p-5 hover:border-brand" href="/admin/users">
            <h2 className="font-bold">User management</h2>
            <p className="mt-1 text-sm text-foreground/65">
              Assign roles, and suspend, deactivate or reactivate access.
            </p>
          </Link>
          <Link className="rounded-xl border border-black/10 p-5 hover:border-brand" href="/admin/audit-log">
            <h2 className="font-bold">Audit log</h2>
            <p className="mt-1 text-sm text-foreground/65">Every recorded action, most recent first.</p>
          </Link>
        </div>
      </section>
    </main>
  );
}
