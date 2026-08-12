import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentActor } from "@/lib/auth/actor";
import { adminRouteDestination } from "@/lib/auth/admin-route";
import { hasPermission } from "@/lib/auth/permissions";
import { reportError } from "@/lib/error-logging";
import {
  filterByOwner,
  filterByTags,
  searchClients,
  visibleClients,
  type ClientListRow,
  type OpenSuppression,
} from "./visible-clients.ts";
import { ClaimButton } from "./[id]/claim-button";
import { RecordOnboardingStep } from "@/components/record-onboarding-step";

type TeamMember = { id: string; full_name: string | null };

// Next.js 16: searchParams is a Promise on App Router pages — same pattern as
// src/app/admin/audit-log/page.tsx.
type SearchParams = Promise<{
  owner?: string;
  q?: string;
  page?: string;
  tags?: string | string[];
}>;

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
 */
export default async function ClientsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const authorization = await getCurrentActor("client:view", { route: "/clients" });
  if (!authorization.ok) redirect(adminRouteDestination(authorization.reason));

  const { owner: ownerFilter, q: search, page: pageParam, tags: tagsParam } =
    await searchParams;
  // Same-name checkboxes submit as a repeated query param; Next.js gives us
  // either a single string (one checked) or string[] (several), normalise
  // to an array either way.
  const tagFilter = tagsParam
    ? Array.isArray(tagsParam)
      ? tagsParam
      : [tagsParam]
    : [];

  const supabase = await createClient();
  const canClaim = hasPermission(authorization.actor.role, "client:edit");

  const [organisations, openSuppressions, team, allTags] = await Promise.all([
    supabase
      .from("organisations")
      .select(
        "id, legal_name, organisation_type, city, country_code, outreach_status, owner_id, owner:users!organisations_owner_id_fkey(full_name), org_tags(tag_id)",
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
    supabase
      .from("tags")
      .select("id, name")
      .order("name")
      .overrideTypes<{ id: string; name: string }[], { merge: false }>(),
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
  if (allTags.error) {
    await reportError(allTags.error, { operation: "clients.page_tags" });
  }

  const matchingClients = searchClients(
    filterByTags(
      filterByOwner(
        visibleClients(organisations.data ?? [], openSuppressions.data ?? []),
        ownerFilter,
      ),
      tagFilter,
    ),
    search,
  );
  const teamMembers = team.data ?? [];
  const availableTags = allTags.data ?? [];
  const filterActive = Boolean(ownerFilter || search || tagFilter.length > 0);
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
    for (const tagId of tagFilter) params.append("tags", tagId);
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
    <main className="min-h-screen bg-[#f1f2f4] p-6">
      {reviewingOwnClients && <RecordOnboardingStep step="review_clients" />}
      <section className="mx-auto w-full max-w-3xl rounded-2xl bg-white p-8 shadow-sm">
        <p className="text-sm font-bold text-brand">180Connect</p>
        <h1 className="mt-2 text-2xl font-bold">{isOwnedView ? "My clients" : "Clients"}</h1>
        <p className="mt-3 text-sm text-foreground/65">
          {isOwnedView
            ? "Clients you currently own. Reassigned away from you, or to you, this list reflects it on your next visit."
            : "The active working list. A suppressed charity is hidden from here until an admin lifts the suppression."}
        </p>

        {(organisations.error || openSuppressions.error) && (
          <p className="mt-5 rounded-xl bg-red-50 p-4 text-sm font-bold text-red-800" role="alert">
            Some data could not be loaded. Refresh and try again.
          </p>
        )}

        <form className="mt-6 flex flex-wrap items-end gap-3" method="get">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-foreground/65">Search</span>
            <input
              type="search"
              name="q"
              defaultValue={search ?? ""}
              placeholder="Client name"
              className="rounded-lg border border-black/10 px-3 py-2 text-sm"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="text-foreground/65">Owner</span>
            <select
              name="owner"
              defaultValue={ownerFilter ?? ""}
              className="rounded-lg border border-black/10 px-3 py-2 text-sm"
            >
              <option value="">Everyone</option>
              <option value="unassigned">Unassigned</option>
              {teamMembers.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.full_name ?? "Unnamed CAM"}
                </option>
              ))}
            </select>
          </label>
          {availableTags.length > 0 && (
            <fieldset className="flex flex-col gap-1 text-sm">
              <legend className="text-foreground/65">Tags</legend>
              <div className="flex flex-wrap gap-3">
                {availableTags.map((tag) => (
                  <label key={tag.id} className="flex items-center gap-1.5 text-sm">
                    <input
                      type="checkbox"
                      name="tags"
                      value={tag.id}
                      defaultChecked={tagFilter.includes(tag.id)}
                    />
                    {tag.name}
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          <button
            type="submit"
            className="rounded-full border border-black/10 px-5 py-2 text-sm font-bold hover:bg-black/5"
          >
            Filter
          </button>

          {authorization.actor.role === "cam" && (
            <Link
              href={`/clients?owner=${authorization.actor.id}`}
              className={`text-sm font-bold hover:underline ${
                ownerFilter === authorization.actor.id ? "text-brand" : "text-foreground/65"
              }`}
            >
              My clients
            </Link>
          )}

          {filterActive && (
            <Link href="/clients" className="text-sm font-medium text-brand hover:underline">
              Clear filters
            </Link>
          )}
        </form>

        {matchingClients.length > 0 && (
          <p className="mt-4 text-xs text-foreground/50">
            {matchingClients.length} client{matchingClients.length === 1 ? "" : "s"}
            {isOwnedView ? " you own" : ""}
            {totalPages > 1 ? ` · page ${currentPage} of ${totalPages}` : ""}
          </p>
        )}

        {clients.length === 0 ? (
          <p className="mt-8 text-sm text-foreground/65">
            {isOwnedView
              ? "You don't own any clients yet. Claim one from the list, or ask an admin to assign you one."
              : filterActive
                ? "No clients match this filter."
                : "No clients to show."}
          </p>
        ) : (
          <ul className="mt-8 divide-y divide-black/5">
            {clients.map((client) => (
              <li key={client.id} className="flex items-center gap-4 py-4">
                <Link
                  className="flex flex-1 items-center justify-between gap-4 hover:bg-black/2.5"
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
                    {client.ownerName ? (
                      <span className="rounded-full bg-brand/10 px-2 py-1 text-xs font-bold text-brand-hover">
                        {client.ownerName}
                      </span>
                    ) : (
                      <span className="rounded-full bg-black/5 px-2 py-1 text-xs font-bold text-foreground/50">
                        Unassigned
                      </span>
                    )}
                    {client.suppressionPending && (
                      <span className="rounded-full bg-amber-50 px-2 py-1 text-xs font-bold text-amber-800">
                        Suppression requested
                      </span>
                    )}
                  </span>
                </Link>
                {canClaim && !client.ownerName && (
                  <ClaimButton compact organisationId={client.id} />
                )}
              </li>
            ))}
          </ul>
        )}

        {totalPages > 1 && (
          <nav className="mt-6 flex items-center justify-between text-sm">
            {currentPage > 1 ? (
              <Link href={pageHref(currentPage - 1)} className="font-bold text-brand hover:underline">
                ← Previous
              </Link>
            ) : (
              <span />
            )}
            <span className="text-foreground/50">
              Page {currentPage} of {totalPages}
            </span>
            {currentPage < totalPages ? (
              <Link href={pageHref(currentPage + 1)} className="font-bold text-brand hover:underline">
                Next →
              </Link>
            ) : (
              <span />
            )}
          </nav>
        )}
      </section>
    </main>
  );
}
