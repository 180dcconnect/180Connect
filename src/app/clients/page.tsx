import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentActor } from "@/lib/auth/actor";
import { adminRouteDestination } from "@/lib/auth/admin-route";
import { hasPermission } from "@/lib/auth/permissions";
import { reportError } from "@/lib/error-logging";
import {
  filterByOwner,
  filterByCity,
  filterByStatus,
  filterBySource,
  searchClients,
  visibleClients,
  type ClientListRow,
  type OpenSuppression,
} from "./visible-clients.ts";
import { BrandSearchBar } from "@/components/brand/search-bar";
import { ClaimButton } from "./[id]/claim-button";
import { RecordOnboardingStep } from "@/components/record-onboarding-step";
import { Group, Rise } from "@/components/dashboard-stage";
import { SearchRail } from "@/components/search-rail";

type TeamMember = { id: string; full_name: string | null };

// Next.js 16: searchParams is a Promise on App Router pages — same pattern as
// src/app/admin/audit-log/page.tsx.
type SearchParams = Promise<{ owner?: string; q?: string; page?: string; city?: string; status?: string; source?: string }>;

const PAGE_SIZE = 25;

/**
 * F051 — the charity list view. Every organisation regardless of import method
 * or manual entry (F031/F032/F036) shows here, minus anything F251 has actively
 * suppressed. Row click leads to the F067/F068 detail page (src/app/clients/[id]).
 *
 * F162 (#157): the claim button sits beside the row's Link rather than inside it —
 * a button nested in an anchor is invalid markup and would fire both handlers on
 * click. Only unassigned rows show it, and only to an actor who can edit clients.
 *
 * F163 (#163): owner filter. The team dropdown lists CAMs only (not admins) —
 * the AC asks for "any CAM on the team", and an admin who owns a client via the
 * admin assign path is the rare edge case, not the filter's job to cover.
 *
 * F166 (#162) View My Owned Clients: AC1 asks for "the same list view as F051 with
 * the owner filter (F057) pre-applied" — deliberately not a separate page, so
 * `?owner=<self>` (the existing "My clients" link) *is* the view, not a stand-in
 * for it. isOwnedView below only changes copy (heading, empty state) for that one
 * case. AC2 (updates without a manual refresh) is free: this page has no cache —
 * every visit re-queries organisations, so a reassignment shows up on the next
 * normal navigation here, same as any other filter change.
 *
 * Restyled onto the same bone-ground/floating-card language as /dashboard
 * (docs/design-system.md's *character*, not its public palette — see that
 * page's comment). Filter bar, list, and pagination are three separate cards
 * rather than one box holding everything, and the root is a `div`: AppShell
 * already renders the `main` this is slotted into.
 */
export default async function ClientsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const authorization = await getCurrentActor("client:view", { route: "/clients" });
  if (!authorization.ok) redirect(adminRouteDestination(authorization.reason));

  const { owner: ownerFilter, q: search, page: pageParam, city, status, source } = await searchParams;

  const supabase = await createClient();
  const canClaim = hasPermission(authorization.actor.role, "client:edit");

  const [organisations, openSuppressions, team] = await Promise.all([
    supabase
      .from("organisations")
      .select(
        "id, legal_name, organisation_type, city, country_code, outreach_status, owner_id, owner:users!organisations_owner_id_fkey(full_name)",
      )
      .order("legal_name")
      .overrideTypes<ClientListRow[], { merge: false }>(),
    supabase
      .from("suppressions")
      .select("organisation_id, status")
      .in("status", ["pending", "active"])
      .overrideTypes<OpenSuppression[], { merge: false }>(),
    supabase
      .from("users")
      .select("id, full_name")
      .eq("role", "cam")
      .order("full_name")
      .overrideTypes<TeamMember[], { merge: false }>(),
  ]);

  if (organisations.error) {
    await reportError(organisations.error, { operation: "clients.page_list" });
  }
  if (openSuppressions.error) {
    await reportError(openSuppressions.error, { operation: "clients.page_suppressions" });
  }
  if (team.error) {
    await reportError(team.error, { operation: "clients.page_team" });
  }

  const allVisibleClients = visibleClients(organisations.data ?? [], openSuppressions.data ?? []);
  
  const uniqueCities = Array.from(new Set(allVisibleClients.map(c => c.city).filter(Boolean))).sort() as string[];
  const uniqueStatuses = Array.from(new Set(allVisibleClients.map(c => c.outreachStatusLabel).filter(Boolean))).sort() as string[];
  
  const sourceLabels: Record<string, string> = {
    company: "Companies House",
    charity: "Charity Commission",
    both: "Dual-registered",
    other: "Other"
  };
  const uniqueSourceTypes = Array.from(new Set(allVisibleClients.map(c => c.organisation_type).filter(Boolean)));
  const uniqueSources = uniqueSourceTypes.map(t => sourceLabels[t] || t).sort();

  let matchingClients = allVisibleClients;
  matchingClients = filterByOwner(matchingClients, ownerFilter);
  matchingClients = filterByCity(matchingClients, city);
  matchingClients = filterByStatus(matchingClients, status);
  matchingClients = filterBySource(matchingClients, source);
  matchingClients = searchClients(matchingClients, search);
  const teamMembers = team.data ?? [];
  const filterActive = Boolean(ownerFilter || search || city || status || source);
  // F166 AC1/AC3: this is the CAM viewing their own filter, not just any owner
  // filter — the heading, count label and empty state read "your clients" so the
  // view reads as its own thing rather than a generic filtered list.
  const isOwnedView =
    authorization.actor.role === "cam" && ownerFilter === authorization.actor.id;

  const totalPages = Math.max(1, Math.ceil(matchingClients.length / PAGE_SIZE));
  const requestedPage = Number.parseInt(pageParam ?? "1", 10);
  const currentPage = Number.isInteger(requestedPage)
    ? Math.min(Math.max(requestedPage, 1), totalPages)
    : 1;
  const clients = matchingClients.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  );

  const pageHref = (targetPage: number) => {
    const params = new URLSearchParams();
    if (ownerFilter) params.set("owner", ownerFilter);
    if (search) params.set("q", search);
    if (city) params.set("city", city);
    if (status) params.set("status", status);
    if (source) params.set("source", source);
    if (targetPage > 1) params.set("page", String(targetPage));
    const qs = params.toString();
    return qs ? `/clients?${qs}` : "/clients";
  };

  // F255 step 2 — "review your assigned clients" is complete when the CAM has looked
  // at their own list, which is this page filtered to themselves. Recording it here
  // rather than on the guide's link means the step reflects what they did, not what
  // they clicked. Anyone else's filtered list, or the unfiltered one, records nothing.
  const reviewingOwnClients = ownerFilter === authorization.actor.id;

  return (
    <div className="min-h-screen bg-[#f4f4ef] px-6 py-10 sm:px-10 sm:py-12">
      {reviewingOwnClients && <RecordOnboardingStep step="review_clients" />}
      <SearchRail
        headingClassName="mb-8"
        bar={
          <BrandSearchBar
            defaultQuery={search ?? ""}
            defaultFilters={[
              ...(city ? [{ category: "Filter by city", label: city, value: city }] : []),
              ...(status ? [{ category: "Filter by outreach status", label: status, value: status }] : []),
              ...(source ? [{ category: "Filter by source", label: source, value: source }] : []),
              ...(ownerFilter === "unassigned" ? [{ category: "Filter by owner", label: "Unassigned", value: "unassigned" }] : []),
              ...(ownerFilter && ownerFilter !== "unassigned" && teamMembers.find(m => m.id === ownerFilter) ? [{ category: "Filter by owner", label: teamMembers.find(m => m.id === ownerFilter)?.full_name || "Unnamed CAM", value: ownerFilter }] : [])
            ]}
            params={{
              "Filter by city": "city",
              "Filter by outreach status": "status",
              "Filter by source": "source",
              "Filter by owner": "owner",
            }}
            categories={{
              "Filter by city": uniqueCities.map(c => ({ label: c, value: c })),
              "Filter by outreach status": uniqueStatuses.map(c => ({ label: c, value: c })),
              "Filter by source": uniqueSources.map(c => ({ label: c, value: c })),
              "Filter by owner": [
                { label: "Unassigned", value: "unassigned" },
                ...teamMembers.map(m => ({ label: m.full_name || "Unnamed CAM", value: m.id }))
              ]
            }}
          />
        }
        heading={
          <>
            <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/40">
              {isOwnedView ? "Filtered to you" : "Client records"}
            </p>
            <h1 className="mt-2 text-[clamp(2rem,4vw,2.75rem)] font-black leading-[1] tracking-[-0.03em]">
              {isOwnedView ? "My clients" : "Clients"}
            </h1>
            <p className="mt-3 text-sm leading-[1.7] text-foreground/65">
              {isOwnedView
                ? "Clients you currently own. Reassigned away from you, or to you, this list reflects it on your next visit."
                : "The active working list. A suppressed charity is hidden from here until an admin lifts the suppression."}
            </p>

            {authorization.actor.role === "cam" && (
              <Link
                href={`/clients?owner=${authorization.actor.id}`}
                className={`mt-3 inline-block text-sm font-bold hover:underline ${
                  ownerFilter === authorization.actor.id ? "text-brand" : "text-foreground/65"
                }`}
              >
                My clients
              </Link>
            )}
          </>
        }
      >

        {(organisations.error || openSuppressions.error) && (
          <Rise>
            <p
              role="alert"
              className="rounded-2xl border border-destructive/20 bg-destructive/[0.06] px-5 py-4 text-sm font-bold text-destructive mb-8"
            >
              Some data could not be loaded. Refresh and try again.
            </p>
          </Rise>
        )}

        <Group className="space-y-4">
          {matchingClients.length > 0 && (
            <Rise className="flex items-baseline justify-between gap-4">
              <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/35">
                {matchingClients.length} client{matchingClients.length === 1 ? "" : "s"}
                {isOwnedView ? " you own" : ""}
              </p>
              {totalPages > 1 && (
                <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/35">
                  Page {currentPage} of {totalPages}
                </p>
              )}
            </Rise>
          )}

          <Rise>
            {clients.length === 0 ? (
              <div className="rounded-2xl border border-black/[0.06] bg-white px-5 py-8 shadow-sm">
                <p className="text-center text-sm leading-[1.7] text-foreground/65">
                  {isOwnedView
                    ? "You don't own any clients yet. Claim one from the list, or ask an admin to assign you one."
                    : filterActive
                      ? "No clients match this filter."
                      : "No clients to show."}
                </p>
              </div>
            ) : (
              <ul className="overflow-hidden rounded-2xl border border-black/[0.06] bg-white shadow-sm">
                {clients.map((client, index) => (
                  <li
                    key={client.id}
                    className="flex items-center gap-4 border-b border-black/[0.06] px-5 py-4 last:border-b-0"
                  >
                    <Link
                      className="group flex min-w-0 flex-1 items-center gap-4 rounded-xl -m-2 p-2 transition-colors hover:bg-black/[0.02] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand"
                      href={`/clients/${client.id}`}
                    >
                      <span
                        aria-hidden="true"
                        className="w-6 shrink-0 text-[11px] font-bold tabular-nums text-foreground/25"
                      >
                        {String((currentPage - 1) * PAGE_SIZE + index + 1).padStart(2, "0")}
                      </span>
                      <span className="min-w-0 flex-1">
                        {/* Two lines on a phone rather than a hard truncate:
                            "1066 BATTL…" identifies nothing, and the column is
                            ~200px once the claim button has its share. */}
                        <span className="line-clamp-2 text-[15px] font-bold sm:block sm:truncate">
                          {client.legal_name}
                        </span>
                        <span className="block truncate text-sm text-foreground/50">
                          {client.organisation_type} · {client.location}
                        </span>
                      </span>
                      <span className="hidden shrink-0 items-center gap-2 sm:flex">
                        <span className="rounded-full bg-black/[0.05] px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.08em] text-foreground/55">
                          {client.outreachStatusLabel}
                        </span>
                        {client.ownerName ? (
                          <span className="rounded-full bg-brand/10 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.08em] text-brand-hover">
                            {client.ownerName}
                          </span>
                        ) : (
                          <span className="rounded-full bg-black/[0.05] px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.08em] text-foreground/40">
                            Unassigned
                          </span>
                        )}
                        {client.suppressionPending && (
                          <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.08em] text-amber-800">
                            Suppression requested
                          </span>
                        )}
                      </span>
                      <span
                        aria-hidden="true"
                        className="hidden shrink-0 text-foreground/25 transition-all duration-200 group-hover:translate-x-0.5 group-hover:text-foreground/55 sm:block"
                      >
                        →
                      </span>
                    </Link>
                    {canClaim && !client.ownerName && (
                      <ClaimButton compact organisationId={client.id} />
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Rise>

          {totalPages > 1 && (
            <Rise className="flex items-center justify-between gap-4 pt-4">
              {currentPage > 1 ? (
                <Link
                  href={pageHref(currentPage - 1)}
                  className="rounded-full bg-white px-5 py-2 text-[13px] font-bold shadow-sm ring-1 ring-black/[0.06] transition-shadow hover:shadow focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                >
                  ← Previous
                </Link>
              ) : (
                <div />
              )}
              {currentPage < totalPages ? (
                <Link
                  href={pageHref(currentPage + 1)}
                  className="rounded-full bg-white px-5 py-2 text-[13px] font-bold shadow-sm ring-1 ring-black/[0.06] transition-shadow hover:shadow focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                >
                  Next →
                </Link>
              ) : (
                <div />
              )}
            </Rise>
          )}
        </Group>
      </SearchRail>
    </div>
  );
}
