import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentActor } from "@/lib/auth/actor";
import { adminRouteDestination } from "@/lib/auth/admin-route";
import { reportError } from "@/lib/error-logging";
import { OWNERSHIP_REQUEST_SELECT, type OwnershipRequestRow } from "@/lib/ownership-requests";
import { OwnershipRequestsPanel } from "./ownership-requests-panel";

/**
 * #408 — the admin half of Request Client Ownership. A CAM cannot take a client another
 * CAM owns; this queue is where that ask is decided. Approving moves the client through
 * reassign_ownership inside decide_ownership_request, so the handover is audited the
 * same way F163's assign form is.
 */
export default async function OwnershipRequestsPage() {
  const authorization = await getCurrentActor("approval:manage", {
    route: "/admin/ownership-requests",
  });
  if (!authorization.ok) redirect(adminRouteDestination(authorization.reason));

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("ownership_requests")
    .select(OWNERSHIP_REQUEST_SELECT)
    .order("created_at", { ascending: false })
    .overrideTypes<OwnershipRequestRow[], { merge: false }>();

  if (error) {
    await reportError(error, { operation: "admin.ownership_requests.page_list" });
  }

  return (
    <main className="min-h-screen bg-[#f1f2f4] p-6">
      <section className="mx-auto w-full max-w-4xl rounded-2xl bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-bold">Ownership requests</h1>
        <p className="mt-3 text-sm text-foreground/65">
          A CAM cannot take a client another CAM owns — they ask here instead. Approving
          moves the client to them, along with their open actions, and records the
          handover in the audit log. Rejecting leaves ownership exactly as it is.
        </p>

        {error && (
          <p className="mt-5 rounded-xl bg-red-50 p-4 text-sm font-bold text-red-800" role="alert">
            The requests could not be loaded. Refresh and try again.
          </p>
        )}

        <OwnershipRequestsPanel initialRequests={data ?? []} />
      </section>
    </main>
  );
}
