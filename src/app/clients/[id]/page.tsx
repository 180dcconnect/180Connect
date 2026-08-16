import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentActor } from "@/lib/auth/actor";
import { adminRouteDestination } from "@/lib/auth/admin-route";
import { hasPermission } from "@/lib/auth/permissions";
import { reportError } from "@/lib/error-logging";
import { InlineAlert } from "@/components/ui/inline-alert";
import { validateClientEmail } from "@/lib/client-email-validation";
import {
  formatOrganisationSources,
  type OrganisationSourceRow,
} from "@/lib/source-tracking";
import { checkWebsiteReachabilityCached } from "@/lib/website-reachability-cache";
import { websiteHref } from "@/lib/website-validation";
import { formatLocation, formatOutreachStatus } from "@/lib/organisation-format";
import { Group, Rise, Stage } from "@/components/dashboard-stage";
import type { OrganisationDetailRow } from "@/lib/client-basic-info";
import { SuppressButton } from "./suppress-button";
import { ComposeButton } from "./compose-button";
import { BasicInfoPanel } from "./basic-info-panel";
import { ClaimButton } from "./claim-button";
import { AssignOwnerForm } from "./assign-owner-form";
import { StatusSelect } from "./status-select";
import { Pill, SectionCard } from "./section-card";

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
  // Never `href={website.url}`: on the invalid branch that field is the raw
  // stored text, and a browser resolves a scheme-less string as a path — the
  // "link" to `1-1coco.org` navigated to /clients/1-1coco.org.
  const websiteLink = websiteHref(website);
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
    .rpc("get_organisation_sources_with_actor", { p_organisation_id: id });

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

  const statusLabel = formatOutreachStatus(client.outreach_status);
  const suppressed = latest?.status === "active";
  const suppressionPending = latest?.status === "pending";

  return (
    <div className="min-h-screen bg-[#f4f4ef] px-6 py-10 sm:px-10 sm:py-12">
      <Stage className="mx-auto w-full max-w-5xl space-y-6">
        <Rise>
          <Link
            className="group inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/40 transition-colors hover:text-foreground/70"
            href="/clients"
          >
            <span aria-hidden="true" className="transition-transform group-hover:-translate-x-0.5">
              ←
            </span>
            Clients
          </Link>

          <div className="mt-4 flex flex-wrap items-end justify-between gap-x-8 gap-y-5">
            <div className="min-w-0">
              <h1 className="text-[clamp(1.75rem,3.5vw,2.5rem)] font-semibold font-body leading-[1.05] tracking-[-0.03em]">
                {client.legal_name}
              </h1>
              {/* The record's identity in one line of markers rather than four
                  rows of a table: what it is, where it is, and the two states
                  that change what anyone is allowed to do with it. */}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Pill>{client.organisation_type}</Pill>
                <Pill>{formatLocation(client)}</Pill>
                <Pill tone={suppressed ? "neutral" : "brand"}>{statusLabel}</Pill>
                {suppressed && <Pill tone="danger">Do not contact</Pill>}
                {suppressionPending && <Pill tone="warn">DNC requested</Pill>}
              </div>
            </div>

            {ownerId && (
              <p className="text-sm leading-[1.7] text-foreground/50">
                Owned by{" "}
                <span className="font-bold text-foreground/75">{ownerName}</span>
                {ownerId === authorization.actor.id ? " (you)" : ""}
              </p>
            )}
          </div>
        </Rise>

        {/* The suppression state leads the record instead of closing it: it
            governs whether outreach is allowed at all, so it has to be read
            before the sections that offer to do outreach — including
            ComposeButton, whose blocked state points back up at this. */}
        {suppressed && (
          <Rise>
            <div
              role="alert"
              className="rounded-2xl border border-destructive/20 bg-destructive/[0.06] px-5 py-4"
            >
              <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-destructive">
                Do not contact
              </p>
              <p className="mt-2 text-sm leading-[1.7] text-destructive/90">{latest.reason}</p>
              <p className="mt-1.5 text-[13px] leading-[1.6] text-destructive/60">
                Hidden from the active working list. Outreach is blocked. Only an admin
                can lift this.
              </p>
            </div>
          </Rise>
        )}

        {suppressionPending && (
          <Rise>
            <div className="rounded-2xl border border-amber-500/25 bg-amber-500/[0.07] px-5 py-4">
              <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-amber-800">
                Do not contact requested
              </p>
              <p className="mt-2 text-sm leading-[1.7] text-amber-900/85">{latest.reason}</p>
              <p className="mt-1.5 text-[13px] leading-[1.6] text-amber-800/60">
                Awaiting admin review.
              </p>
            </div>
          </Rise>
        )}

        {/* Two columns from `lg`: the record itself on the left, the things you
            do to it on the right. F067 AC2 asks for every section to be
            reachable without excessive scrolling, and one narrow column of
            eight stacked cards stopped being that once ownership, status and
            sources landed. Below `lg` it folds back to one column in the same
            order. */}
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
          <Group className="space-y-4">
            <Rise>
              <BasicInfoPanel
                organisation={client}
                missionStatement={enrichment?.mission_statement ?? null}
                missionEnrichedAt={enrichment?.enriched_at ?? null}
              />
            </Rise>

            {/* Email and website were two near-identical cards — same
                heading-plus-validity-pill shape, same failure copy — so they
                read as one "can we actually reach them?" card instead. */}
            <Rise>
              <SectionCard headingId="contactability-heading" title="Contactability">
                <dl className="mt-4 divide-y divide-black/[0.05]">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1.5 pb-3.5">
                    <dt className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/35">
                      Email
                    </dt>
                    <Pill tone={email.status === "valid" ? "brand" : "danger"}>
                      {email.status === "valid"
                        ? "Valid format"
                        : email.status === "invalid"
                          ? "Invalid format"
                          : "Missing"}
                    </Pill>
                    <dd
                      className={`w-full break-all text-sm leading-[1.6] ${
                        email.status === "invalid"
                          ? "font-bold text-destructive"
                          : email.value
                            ? "text-foreground/80"
                            : "text-foreground/35"
                      }`}
                    >
                      {email.value ?? "Not provided"}
                    </dd>
                    {email.message && (
                      <p className="w-full text-[13px] leading-[1.6] text-destructive/80" role="alert">
                        {email.message} The rest of this client record is still available.
                      </p>
                    )}
                  </div>

                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1.5 pt-3.5">
                    <dt className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/35">
                      Website
                    </dt>
                    <Pill tone={website.status === "reachable" ? "brand" : "danger"}>
                      {website.status === "reachable"
                        ? "Reachable"
                        : website.status === "invalid"
                          ? "Invalid URL"
                          : website.status === "missing"
                            ? "Missing"
                            : "Unreachable"}
                    </Pill>
                    <dd className="w-full text-sm leading-[1.6]">
                      {websiteLink ? (
                        <a
                          className={`break-all underline underline-offset-2 transition-colors ${
                            website.status === "reachable"
                              ? "text-brand-hover hover:text-brand"
                              : "font-bold text-destructive"
                          }`}
                          href={websiteLink}
                          rel="noreferrer"
                          target="_blank"
                        >
                          {websiteLink}
                        </a>
                      ) : website.url ? (
                        // Malformed: show what is stored, as text. There is
                        // nowhere safe to send anyone.
                        <span className="break-all font-bold text-destructive">{website.url}</span>
                      ) : (
                        <span className="text-foreground/35">Not provided</span>
                      )}
                    </dd>
                    {website.message && (
                      <p className="w-full text-[13px] leading-[1.6] text-destructive/80" role="alert">
                        {website.message} Booklet generation may use unreliable or missing
                        website context.
                      </p>
                    )}
                  </div>
                </dl>
              </SectionCard>
            </Rise>

            <Rise>
              <SectionCard
                headingId="source-heading"
                title="Record sources"
                hint="Where the information in this client record came from."
              >
                {sourcesError ? (
                  <InlineAlert message="Source information could not be loaded. Refresh and try again." />
                ) : sources.length === 0 ? (
                  <p className="mt-4 text-sm leading-[1.7] text-foreground/45">
                    No source information recorded.
                  </p>
                ) : (
                  <ul className="mt-4 flex flex-wrap gap-2">
                    {sources.map((source) => (
                      <li
                        key={source.source}
                        className="rounded-full bg-brand/10 px-3 py-1.5 text-[13px] font-bold text-brand-hover"
                        title={`First recorded ${new Date(source.first_seen_at).toLocaleDateString("en-GB")}`}
                      >
                        {source.label}
                        {source.source_actor_name ? ` · ${source.source_actor_name}` : ""}
                      </li>
                    ))}
                  </ul>
                )}
              </SectionCard>
            </Rise>
          </Group>

          <Group className="space-y-4">
            <Rise>
              <SectionCard headingId="ownership-heading" title="Ownership">
                {ownerId ? (
                  <p className="mt-3 text-sm leading-[1.7] text-foreground/65">
                    Owned by <span className="font-bold text-foreground/85">{ownerName}</span>
                    {ownerId === authorization.actor.id ? " (you)" : ""}.
                  </p>
                ) : canEdit ? (
                  <div className="mt-3 space-y-3">
                    <p className="text-sm leading-[1.7] text-foreground/55">
                      Unassigned. Claim it to take responsibility for outreach on this
                      client.
                    </p>
                    <ClaimButton organisationId={client.id} />
                  </div>
                ) : (
                  <p className="mt-3 text-sm leading-[1.7] text-foreground/45">Unassigned.</p>
                )}

                {isAdmin && (
                  <AssignOwnerForm
                    organisationId={client.id}
                    currentOwnerId={ownerId}
                    currentOwnerName={ownerName}
                    team={team}
                  />
                )}
              </SectionCard>
            </Rise>

            {(isAdmin || ownerId === authorization.actor.id) && (
              <Rise>
                <SectionCard
                  headingId="status-heading"
                  title="Pipeline status"
                  hint="Where this client sits in the outreach pipeline. Shown on the client list too."
                >
                  <StatusSelect
                    organisationId={client.id}
                    currentStatus={client.outreach_status}
                  />
                </SectionCard>
              </Rise>
            )}

            {hasPermission(authorization.actor.role, "client:contact") && (
              <Rise>
                <SectionCard headingId="outreach-heading" title="Outreach">
                  <div className="mt-4">
                    <ComposeButton blocked={suppressed} />
                  </div>
                </SectionCard>
              </Rise>
            )}

            {/* Only the action lives down here — the resulting state is the
                banner at the top of the page, so there is nothing to show once
                a suppression exists. */}
            {!suppressed && !suppressionPending && canSuppress && (
              <Rise>
                <SectionCard
                  headingId="suppress-heading"
                  title="Do not contact"
                  tone="danger"
                  hint="Flagging this client hides it from the active working list and blocks outreach."
                >
                  <div className="mt-4">
                    <SuppressButton
                      organisationId={client.id}
                      selfApproves={isAdmin}
                    />
                  </div>
                </SectionCard>
              </Rise>
            )}
          </Group>
        </div>
      </Stage>
    </div>
  );
}
