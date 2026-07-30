import { redirect } from "next/navigation";
import { getCurrentActor } from "@/lib/auth/actor";

/**
 * `/admin` used to be a hub of tiles, three of which pointed at features that do
 * not exist. Team management is the only admin workspace built so far, so this
 * route now forwards straight to it — one less click, and nothing on screen that
 * cannot be clicked. Restore a hub here when there is a second destination to
 * choose between (list it in `src/lib/nav.ts` first).
 */
export default async function AdminPage() {
  const authorization = await getCurrentActor("user:manage");
  if (!authorization.ok) {
    if (authorization.reason === "unauthenticated") redirect("/login");
    redirect("/dashboard?error=admin-access-required");
  }

  redirect("/admin/users");
}
