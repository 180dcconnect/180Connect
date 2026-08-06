import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentActor } from "@/lib/auth/actor";
import { adminRouteDestination } from "@/lib/auth/admin-route";
import { reportError } from "@/lib/error-logging";

type OrganisationRow = { id: string; legal_name: string; organisation_type: string };
type OpenSuppression = { organisation_id: string; status: "pending" | "active" };

/**
 * F251 AC1/AC2 minimal home: tap a client to reach the one thing this story needs —
 * the suppress action. Not F067 (Client Detail Page, #69, still open) — no notes, no
 * timeline, no editable fields. Just enough surface to host the button without
 * redoing F067's job under this ticket.
 */
export default async function ClientsPage() {
  const authorization = await getCurrentActor("client:view", { route: "/clients" });
  if (!authorization.ok) redirect(adminRouteDestination(authorization.reason));

  const supabase = await createClient();

  const [organisations, openSuppressions] = await Promise.all([
    supabase
      .from("organisations")
      .select("id, legal_name, organisation_type")
      .order("legal_name")
      .overrideTypes<OrganisationRow[], { merge: false }>(),
    supabase
      .from("suppressions")
      .select("organisation_id, status")
      .in("status", ["pending", "active"])
      .overrideTypes<OpenSuppression[], { merge: false }>(),
  ]);

  if (organisations.error) {
    await reportError(organisations.error, { operation: "clients.page_list" });
  }
  if (openSuppressions.error) {
    await reportError(openSuppressions.error, { operation: "clients.page_suppressions" });
  }

  const statusByOrg = new Map(
    (openSuppressions.data ?? []).map((row) => [row.organisation_id, row.status]),
  );

  // "Hidden from the team's active working list" (F251 user story) — an actively
  // suppressed charity does not show up here at all. A pending request still shows
  // (it is not suppressed yet), flagged so the requesting CAM can see it is awaiting
  // an admin.
  const clients = (organisations.data ?? []).filter(
    (organisation) => statusByOrg.get(organisation.id) !== "active",
  );

  return (
    <main className="min-h-screen bg-[#f1f2f4] p-6">
      <section className="mx-auto w-full max-w-3xl rounded-2xl bg-white p-8 shadow-sm">
        <p className="text-sm font-bold text-brand">180Connect</p>
        <h1 className="mt-2 text-2xl font-bold">Clients</h1>
        <p className="mt-3 text-sm text-foreground/65">
          The active working list. A suppressed charity is hidden from here until an
          admin lifts the suppression.
        </p>

        {(organisations.error || openSuppressions.error) && (
          <p className="mt-5 rounded-xl bg-red-50 p-4 text-sm font-bold text-red-800" role="alert">
            Some data could not be loaded. Refresh and try again.
          </p>
        )}

        {clients.length === 0 ? (
          <p className="mt-8 text-sm text-foreground/65">No clients to show.</p>
        ) : (
          <ul className="mt-8 divide-y divide-black/5">
            {clients.map((client) => {
              const pending = statusByOrg.get(client.id) === "pending";
              return (
                <li key={client.id}>
                  <Link
                    className="flex items-center justify-between gap-4 py-4 hover:bg-black/2.5"
                    href={`/clients/${client.id}`}
                  >
                    <span>
                      <span className="font-bold">{client.legal_name}</span>
                      <span className="ml-2 text-sm text-foreground/50">
                        {client.organisation_type}
                      </span>
                    </span>
                    {pending && (
                      <span className="rounded-full bg-amber-50 px-2 py-1 text-xs font-bold text-amber-800">
                        Suppression requested
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}
