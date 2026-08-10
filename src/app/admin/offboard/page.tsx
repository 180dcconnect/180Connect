import { redirect } from "next/navigation";
import { getCurrentActor } from "@/lib/auth/actor";
import { createClient } from "@/lib/supabase/server";
import { reportError } from "@/lib/error-logging";
import { OffboardPanel, type HandoverUser } from "./offboard-panel";

export default async function AdminOffboardPage() {
  const authorization = await getCurrentActor("ownership:reassign");
  if (!authorization.ok) {
    if (authorization.reason === "unauthenticated") redirect("/login");
    redirect("/dashboard?error=admin-access-required");
  }

  const supabase = await createClient();
  const { data: users, error } = await supabase
    .from("users")
    .select("id, email, full_name, role, is_active")
    .in("role", ["cam", "admin"])
    .order("full_name");

  if (error) {
    await reportError(error, { operation: "admin.offboard.page_list" });
  }

  // Everyone with a role that can hold clients may be the one leaving — including an
  // inactive account, which is the usual case: deactivation often happens first and the
  // work is found orphaned afterwards. Only active accounts can receive it, which the
  // RPC enforces independently.
  const candidates = (users ?? []) as HandoverUser[];

  return (
    <main className="min-h-screen bg-[#f1f2f4] p-6">
      <section className="mx-auto max-w-3xl rounded-2xl bg-white p-8 shadow-sm">
        <p className="text-sm font-bold text-brand">Admin workspace</p>
        <h1 className="mt-2 text-3xl font-bold">Reassign a CAM&apos;s work</h1>
        <p className="mt-3 text-sm text-foreground/65">
          Moves every client the outgoing CAM owns, and their open actions, to whoever
          takes over. Notes, emails, replies and drafts stay on the client and follow it
          automatically. Completed work stays credited to the person who did it.
        </p>
        {error && (
          <p className="mt-5 rounded-xl bg-red-50 p-4 text-sm font-bold text-red-800" role="alert">
            The team list could not be loaded. Please refresh and try again.
          </p>
        )}
        <OffboardPanel users={candidates} />
      </section>
    </main>
  );
}
