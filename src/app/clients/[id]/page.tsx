import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentActor } from "@/lib/auth/actor";
import { adminRouteDestination } from "@/lib/auth/admin-route";
import { hasPermission } from "@/lib/auth/permissions";
import { reportError } from "@/lib/error-logging";
import { validateClientEmail } from "@/lib/client-email-validation";
import { SuppressButton } from "./suppress-button";

type OrganisationRow = {
  id: string;
  legal_name: string;
  organisation_type: string;
  contact_email: string | null;
};
type LatestSuppression = {
  status: "pending" | "active" | "rejected" | "lifted";
  reason: string;
  created_at: string;
};

/**
 * F251 AC1/AC2's minimal client screen — see src/app/clients/page.tsx for why this
 * is not F067. Shows the charity's name and its suppression state: nothing else.
 */
export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const authorization = await getCurrentActor("client:view", { route: "/clients/[id]" });
  if (!authorization.ok) redirect(adminRouteDestination(authorization.reason));

  const { id } = await params;
  const supabase = await createClient();

  const { data: client, error: clientError } = await supabase
    .from("organisations")
    .select("id, legal_name, organisation_type, contact_email")
    .eq("id", id)
    .maybeSingle<OrganisationRow>();

  if (clientError) {
    await reportError(clientError, { operation: "clients.detail_page", organisationId: id });
  }
  if (!client) notFound();
  const email = validateClientEmail(client.contact_email);

  // Most recent suppression row for this org, whatever its status — pending shows a
  // waiting state, active shows the suppressed state, rejected/lifted/none all fall
  // through to the suppress button.
  const { data: latest } = await supabase
    .from("suppressions")
    .select("status, reason, created_at")
    .eq("organisation_id", id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<LatestSuppression>();

  const canSuppress = hasPermission(authorization.actor.role, "client:edit");

  return (
    <main className="min-h-screen bg-[#f1f2f4] p-6">
      <section className="mx-auto w-full max-w-2xl rounded-2xl bg-white p-8 shadow-sm">
        <Link className="text-sm font-medium text-brand hover:underline" href="/clients">
          ← Clients
        </Link>
        <p className="mt-4 text-sm font-bold text-brand">{client.organisation_type}</p>
        <h1 className="mt-1 text-2xl font-bold">{client.legal_name}</h1>

        <section className="mt-6 rounded-xl border border-black/10 p-4" aria-labelledby="email-heading">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="email-heading" className="text-sm font-bold">Contact email</h2>
            {email.status === "valid" ? (
              <span className="rounded-full bg-green-50 px-2 py-1 text-xs font-bold text-green-800">
                Valid format
              </span>
            ) : (
              <span className="rounded-full bg-red-50 px-2 py-1 text-xs font-bold text-red-800">
                {email.status === "invalid" ? "Invalid format" : "Missing"}
              </span>
            )}
          </div>

          <p className={`mt-2 break-all text-sm ${email.status === "invalid" ? "font-bold text-red-800" : "text-foreground/75"}`}>
            {email.value ?? "Not provided"}
          </p>

          {email.message && (
            <p className="mt-2 text-sm text-red-800" role="alert">
              {email.message} The rest of this client record is still available.
            </p>
          )}
        </section>

        <div className="mt-8">
          {latest?.status === "active" ? (
            <div className="rounded-xl bg-red-50 p-4">
              <p className="text-sm font-bold text-red-800">Suppressed</p>
              <p className="mt-1 text-sm text-red-800/80">{latest.reason}</p>
              <p className="mt-2 text-xs text-red-800/60">
                Hidden from the active working list. Outreach is blocked. Only an admin
                can lift this.
              </p>
            </div>
          ) : latest?.status === "pending" ? (
            <div className="rounded-xl bg-amber-50 p-4">
              <p className="text-sm font-bold text-amber-800">Suppression requested</p>
              <p className="mt-1 text-sm text-amber-800/80">{latest.reason}</p>
              <p className="mt-2 text-xs text-amber-800/60">Awaiting admin review.</p>
            </div>
          ) : canSuppress ? (
            <SuppressButton
              organisationId={client.id}
              selfApproves={authorization.actor.role === "admin"}
            />
          ) : (
            <p className="text-sm text-foreground/65">Not suppressed.</p>
          )}
        </div>
      </section>
    </main>
  );
}
