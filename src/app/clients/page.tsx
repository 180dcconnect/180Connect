import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentActor } from "@/lib/auth/actor";
import { adminRouteDestination } from "@/lib/auth/admin-route";
import { reportError } from "@/lib/error-logging";
import { visibleClients, type ClientListRow, type OpenSuppression } from "./visible-clients.ts";

/**
 * F051 — the charity list view. Every organisation regardless of import method
 * or manual entry (F031/F032/F036) shows here, minus anything F251 has actively
 * suppressed. Row click still leads to the minimal F251 detail screen — that page
 * is not F067 (Client Detail Page, #69, still open) and this ticket doesn't
 * change that.
 */
export default async function ClientsPage() {
  const authorization = await getCurrentActor("client:view", { route: "/clients" });
  if (!authorization.ok) redirect(adminRouteDestination(authorization.reason));

  const supabase = await createClient();

  const [organisations, openSuppressions] = await Promise.all([
    supabase
      .from("organisations")
      .select("id, legal_name, organisation_type, city, country_code, outreach_status")
      .order("legal_name")
      .overrideTypes<ClientListRow[], { merge: false }>(),
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

  const clients = visibleClients(organisations.data ?? [], openSuppressions.data ?? []);

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
            {clients.map((client) => (
              <li key={client.id}>
                <Link
                  className="flex items-center justify-between gap-4 py-4 hover:bg-black/2.5"
                  href={`/clients/${client.id}`}
                >
                  <span>
                    <span className="font-bold">{client.legal_name}</span>
                    <span className="ml-2 text-sm text-foreground/50">
                      {client.organisation_type} · {client.location}
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="rounded-full bg-black/5 px-2 py-1 text-xs font-bold text-foreground/65">
                      {client.outreachStatusLabel}
                    </span>
                    {client.suppressionPending && (
                      <span className="rounded-full bg-amber-50 px-2 py-1 text-xs font-bold text-amber-800">
                        Suppression requested
                      </span>
                    )}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
