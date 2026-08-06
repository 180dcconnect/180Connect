import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentActor } from "@/lib/auth/actor";
import { adminRouteDestination } from "@/lib/auth/admin-route";
import { hasPermission } from "@/lib/auth/permissions";
import { reportError } from "@/lib/error-logging";
import {
  formatOrganisationSources,
  type OrganisationSourceRow,
} from "@/lib/source-tracking";
import { checkWebsiteReachabilityCached } from "@/lib/website-reachability-cache";
import { SuppressButton } from "./suppress-button";

type OrganisationRow = {
  id: string;
  legal_name: string;
  organisation_type: string;
  website: string | null;
};
type LatestSuppression = {
  status: "pending" | "active" | "rejected" | "lifted";
  reason: string;
  created_at: string;
};

/**
 * F251 AC1/AC2's minimal client screen — see src/app/clients/page.tsx for why this
 * is not F067. Shows the charity's name and its suppression state: nothing else.
 *
 * Also F254 (#51) AC1/AC4/AC5: this same suppress action is the "Do Not Contact"
 * flag — the charity-record wrapper F254 asks for. F254's AC3 ("takes effect with
 * no separate step") only holds for an admin's own call, which self-approves; a
 * CAM's flag still lands pending until an admin reviews it, same as any other
 * suppression request — deliberate per F251, not a gap. Scope note on #51.
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
    .select("id, legal_name, organisation_type, website")
    .eq("id", id)
    .maybeSingle<OrganisationRow>();

  if (clientError) {
    await reportError(clientError, { operation: "clients.detail_page", organisationId: id });
  }
  if (!client) notFound();
  const website = await checkWebsiteReachabilityCached(client.website);

  // The generated Supabase types do not know about this branch's new RPC until the
  // remote schema is regenerated, so narrow its table-shaped result at this boundary.
  const { data: rawSourceRows, error: sourcesError } = await supabase
    .rpc("get_organisation_sources", { p_organisation_id: id });

  if (sourcesError) {
    await reportError(sourcesError, {
      operation: "clients.detail_sources",
      organisationId: id,
    });
  }
  const sources = formatOrganisationSources(
    (rawSourceRows ?? []) as OrganisationSourceRow[],
  );

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

        <section className="mt-6 rounded-xl border border-black/10 p-4" aria-labelledby="source-heading">
          <h2 id="source-heading" className="text-sm font-bold">Record sources</h2>
          <p className="mt-1 text-xs text-foreground/60">
            Where the information in this client record came from.
          </p>
          {sourcesError ? (
            <p className="mt-3 text-sm font-medium text-red-800" role="alert">
              Source information could not be loaded. Refresh and try again.
            </p>
          ) : sources.length === 0 ? (
            <p className="mt-3 text-sm text-foreground/65">No source information recorded.</p>
          ) : (
            <ul className="mt-3 flex flex-wrap gap-2">
              {sources.map((source) => (
                <li
                  key={source.source}
                  className="rounded-full bg-brand/10 px-3 py-1.5 text-sm font-bold text-brand-hover"
                  title={`First recorded ${new Date(source.first_seen_at).toLocaleDateString("en-GB")}`}
                >
                  {source.label}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="mt-6 rounded-xl border border-black/10 p-4" aria-labelledby="website-heading">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="website-heading" className="text-sm font-bold">Website</h2>
            <span className={`rounded-full px-2 py-1 text-xs font-bold ${website.status === "reachable" ? "bg-green-50 text-green-800" : "bg-red-50 text-red-800"}`}>
              {website.status === "reachable"
                ? "Reachable"
                : website.status === "invalid"
                  ? "Invalid URL"
                  : website.status === "missing"
                    ? "Missing"
                    : "Unreachable"}
            </span>
          </div>

          {website.url ? (
            <a
              className={`mt-2 block break-all text-sm underline ${website.status === "reachable" ? "text-brand-hover" : "font-bold text-red-800"}`}
              href={website.url}
              rel="noreferrer"
              target="_blank"
            >
              {website.url}
            </a>
          ) : (
            <p className="mt-2 text-sm text-foreground/65">Not provided</p>
          )}

          {website.message && (
            <p className="mt-2 text-sm text-red-800" role="alert">
              {website.message} Booklet generation may use unreliable or missing website context.
            </p>
          )}
        </section>

        <div className="mt-8">
          {latest?.status === "active" ? (
            <div className="rounded-xl bg-red-50 p-4">
              <p className="text-sm font-bold text-red-800">Do Not Contact</p>
              <p className="mt-1 text-sm text-red-800/80">{latest.reason}</p>
              <p className="mt-2 text-xs text-red-800/60">
                Hidden from the active working list. Outreach is blocked. Only an admin
                can lift this.
              </p>
            </div>
          ) : latest?.status === "pending" ? (
            <div className="rounded-xl bg-amber-50 p-4">
              <p className="text-sm font-bold text-amber-800">Do Not Contact requested</p>
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
