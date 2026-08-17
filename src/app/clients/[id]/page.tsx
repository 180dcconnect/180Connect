import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentActor } from "@/lib/auth/actor";
import { adminRouteDestination } from "@/lib/auth/admin-route";
import { hasPermission } from "@/lib/auth/permissions";
import { reportError } from "@/lib/error-logging";
import { validateClientEmail } from "@/lib/client-email-validation";
import {
  formatOrganisationSources,
  type OrganisationSourceRow,
} from "@/lib/source-tracking";
import { checkWebsiteReachabilityCached } from "@/lib/website-reachability-cache";
import type { OrganisationDetailRow } from "@/lib/client-basic-info";
import { splitOutreachHistory, type OutreachMessageRow } from "@/lib/outreach-history";
import { SuppressButton } from "./suppress-button";
import { ComposeButton } from "./compose-button";
import { BasicInfoPanel } from "./basic-info-panel";
import { ClaimButton } from "./claim-button";
import { AssignOwnerForm } from "./assign-owner-form";
import { StatusSelect } from "./status-select";
import { OutreachHistorySection } from "./outreach-history";

type OrganisationRow = OrganisationDetailRow;
type EnrichmentRow = { mission_statement: string | null; enriched_at: string };
type LatestSuppression = {
  status: "pending" | "active" | "rejected" | "lifted";
  reason: string;
  created_at: string;
};
type OwnerRow = {
  owner_id: string | null;
  owner: { full_name: string | null } | null;
};

/**
 * F067 (#69) Client Detail Page / F068 (#70) View Client Basic Info: opens from the
 * charity list (F051) at /clients/[id] and shows that client's info in one place —
 * BasicInfoPanel below is the F068 basic-info section (AC1/AC2), and this route's
 * own not-found.tsx supplies F067 AC3's clear message for a deleted/merged client
 * id, instead of Next's generic 404. Sections beyond basic info (notes, timeline,
 * F069-081) are still separate open tickets; each will slot in here as its own
 * `<section aria-labelledby>`, same shape as "Record sources" and this one, to
 * keep F067 AC2's "each reachable without excessive scrolling" true as they land.
 *
 * F070 (#72) View Previous Emails is one such section: the Outreach block below
 * now shows every outreach_messages row for this client, split into "Sent" and
 * "Drafts & scheduled" (AC3) — see @/lib/outreach-history for the split/order
 * logic and outreach-history.tsx for the render. Gated on `client:view` like the
 * rest of this page (matches outreach_messages_select_active — read is shared
 * across all active roles, not ownership-scoped), not on `client:contact`, which
 * still gates only ComposeButton within the same section.
 *
 * Started as F251 AC1/AC2's minimal client screen (name + suppression state only)
 * — see src/app/clients/page.tsx for that history. Extended here, not replaced.
 *
 * Also F050 (#52): ComposeButton is a placeholder send action — no real outreach
 * feature exists yet (F094 #93, F100 #99 are both unbuilt). It exists so F050's
 * "blocked, not just discouraged" and "clear message when blocked" ACs can be
 * demonstrated end-to-end now, ahead of the real send UI. The gating check
 * (suppression status) is identical to the one already enforced at the RLS layer
 * (outreach_messages_insert_*, see 20260806120000) — when the real send screen
 * replaces this stub, it must reuse this same gate rather than reinvent it, or the
 * two can drift apart the way the admin RLS policy already once did.
 *
 * Also F254 (#51) AC1/AC4/AC5: this same suppress action is the "Do Not Contact"
 * flag — the charity-record wrapper F254 asks for. F254's AC3 ("takes effect with
 * no separate step") only holds for an admin's own call, which self-approves; a
 * CAM's flag still lands pending until an admin reviews it, same as any other
 * suppression request — deliberate per F251, not a gap. Scope note on #51.
 *
 * Also F162 (#157): the Ownership section is a separate query from BasicInfoPanel's
 * OrganisationDetailRow (same reason "Record sources" is separate — it isn't part
 * of F068's realtime-driven basic-info state). ClaimButton posts to
 * /api/clients/[id]/claim, which calls claim_organisation — see that RPC's header
 * (20260806140000_create_claim_organisation_rpc.sql) for why a direct owner_id write
 * is no longer possible for a CAM's own claim.
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
    .select(
      "id, legal_name, organisation_type, website, contact_email, address_line_1, city, postcode, country_code, outreach_status",
    )
    .eq("id", id)
    .maybeSingle<OrganisationRow>();

  if (clientError) {
    await reportError(clientError, { operation: "clients.detail_page", organisationId: id });
  }
  if (!client) notFound();
  const website = await checkWebsiteReachabilityCached(client.website);
  const email = validateClientEmail(client.contact_email);

  // ENRICHMENT_RESULTS is append-only (20260804180000_create_org_children.sql), so
  // the most recently enriched row is "the" mission statement, not the only one.
  const { data: enrichment, error: enrichmentError } = await supabase
    .from("enrichment_results")
    .select("mission_statement, enriched_at")
    .eq("organisation_id", id)
    .order("enriched_at", { ascending: false })
    .limit(1)
    .maybeSingle<EnrichmentRow>();

  if (enrichmentError) {
    await reportError(enrichmentError, {
      operation: "clients.detail_enrichment",
      organisationId: id,
    });
  }

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

  // Read separately from `client`: owner_id/name isn't part of F068's realtime-driven
  // OrganisationDetailRow, and a deactivated owner's row is invisible under
  // users_select_active (matrix §1) — the fallback below covers that, not an error.
  const { data: ownerRow, error: ownerError } = await supabase
    .from("organisations")
    .select("owner_id, owner:users!organisations_owner_id_fkey(full_name)")
    .eq("id", id)
    .maybeSingle<OwnerRow>();

  if (ownerError) {
    await reportError(ownerError, { operation: "clients.detail_owner", organisationId: id });
  }

  // F070: every outreach message for this client, sent or not. RLS
  // (outreach_messages_select_active) shares read across every active role, so
  // this needs no ownership filter — same reasoning as the `client:view` gate
  // above.
  const { data: outreachRows, error: outreachError } = await supabase
    .from("outreach_messages")
    .select("id, subject, body, send_status, sent_at, scheduled_at, created_at")
    .eq("organisation_id", id)
    .order("created_at", { ascending: false });

  if (outreachError) {
    await reportError(outreachError, {
      operation: "clients.detail_outreach",
      organisationId: id,
    });
  }
  const outreachHistory = splitOutreachHistory(
    (outreachRows ?? []) as OutreachMessageRow[],
  );

  const canEdit = hasPermission(authorization.actor.role, "client:edit");
  const canSuppress = canEdit;
  const ownerId = ownerRow?.owner_id ?? null;
  const ownerName = ownerRow?.owner?.full_name ?? (ownerId ? "A former team member" : null);
  const isAdmin = authorization.actor.role === "admin";

  // F163: admin's CAM picker. Only fetched for an admin — a CAM can't reach the
  // assign form, so the query would be wasted on every other page view.
  let team: { id: string; full_name: string | null }[] = [];
  if (isAdmin) {
    const { data: teamData, error: teamError } = await supabase
      .from("users")
      .select("id, full_name")
      .eq("role", "cam")
      .order("full_name");
    if (teamError) {
      await reportError(teamError, { operation: "clients.detail_team", organisationId: id });
    }
    team = teamData ?? [];
  }

  return (
    <main className="min-h-screen bg-[#f1f2f4] p-6">
      <section className="mx-auto w-full max-w-2xl rounded-2xl bg-white p-8 shadow-sm">
        <Link className="text-sm font-medium text-brand hover:underline" href="/clients">
          ← Clients
        </Link>
        <h1 className="mt-4 text-2xl font-bold">{client.legal_name}</h1>

        <BasicInfoPanel
          organisation={client}
          missionStatement={enrichment?.mission_statement ?? null}
          missionEnrichedAt={enrichment?.enriched_at ?? null}
        />

        <section className="mt-6 rounded-xl border border-black/10 p-4" aria-labelledby="ownership-heading">
          <h2 id="ownership-heading" className="text-sm font-bold">Ownership</h2>
          {ownerId ? (
            <p className="mt-2 text-sm text-foreground/75">
              Owned by <span className="font-bold">{ownerName}</span>
              {ownerId === authorization.actor.id ? " (you)" : ""}.
            </p>
          ) : canEdit ? (
            <div className="mt-2 flex items-center justify-between gap-4">
              <p className="text-sm text-foreground/65">
                Unassigned. Claim it to take responsibility for outreach on this client.
              </p>
              <ClaimButton organisationId={client.id} />
            </div>
          ) : (
            <p className="mt-2 text-sm text-foreground/65">Unassigned.</p>
          )}

          {isAdmin && (
            <AssignOwnerForm
              organisationId={client.id}
              currentOwnerId={ownerId}
              currentOwnerName={ownerName}
              team={team}
            />
          )}
        </section>

        {(authorization.actor.role === "admin" || ownerId === authorization.actor.id) && (
          <section className="mt-6 rounded-xl border border-black/10 p-4" aria-labelledby="status-heading">
            <h2 id="status-heading" className="text-sm font-bold">Pipeline status</h2>
            <p className="mt-1 text-xs text-foreground/60">
              Where this client sits in the outreach pipeline. Shown on the client list too.
            </p>
            <StatusSelect organisationId={client.id} currentStatus={client.outreach_status} />
          </section>
        )}

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

        <section className="mt-8 border-t border-black/10 pt-8" aria-labelledby="outreach-heading">
          <h2 id="outreach-heading" className="text-sm font-bold">Outreach</h2>

          <OutreachHistorySection history={outreachHistory} error={Boolean(outreachError)} />

          {hasPermission(authorization.actor.role, "client:contact") && (
            <div className="mt-6">
              <ComposeButton blocked={latest?.status === "active"} />
            </div>
          )}
        </section>
      </section>
    </main>
  );
}
