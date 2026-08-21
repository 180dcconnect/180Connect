import Link from "next/link";
import { Sparkles } from "lucide-react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentActor } from "@/lib/auth/actor";
import { adminRouteDestination } from "@/lib/auth/admin-route";
import { hasPermission } from "@/lib/auth/permissions";
import { reportError } from "@/lib/error-logging";
import { InlineAlert } from "@/components/ui/inline-alert";
import { EmptyState } from "@/components/ui/empty-state";
import {
  emptyStateMessage,
  filterByOwner,
  filterByTags,
  filterByCity,
  filterByCountry,
  filterByStatus,
  filterByType,
  filterValues,
  LIST_SORT_DIRECTIONS,
  LIST_SORT_FIELDS,
  parseListDirection,
  parseListSort,
  searchClients,
  sortClients,
  visibleClients,
  type ClientListRow,
  type OpenSuppression,
} from "./visible-clients.ts";
import { BrandSearchBar } from "@/components/brand/search-bar";
import { ClaimButton } from "./[id]/claim-button";
import { ClientOwnerBadge } from "./client-owner-badge";
import { RecordOnboardingStep } from "@/components/record-onboarding-step";
import { Group, Rise } from "@/components/dashboard-stage";
import { OriginButton } from "@/components/ui/origin-button";
import { SearchRail } from "@/components/search-rail";
import {
  SOURCE_LABELS,
  breakdown,
  breakdownLimit,
  parseDirection,
  parseField,
  parseStage,
  pipelineFunnel,
  type BreakdownRow,
  type FunnelStageKey,
} from "./client-insights";
import {
  ORGANISATION_TYPES,
  PIPELINE_STATUSES,
  formatOrganisationType,
  formatOutreachStatus,
} from "@/lib/organisation-format";
import { PipelineReport } from "./pipeline-report";
import { SortMenu as ListSortMenu } from "./sort-menu";
import { BulkSelectProvider } from "./bulk-select-provider";
import { ClientRowCheckbox, SelectAllCheckbox } from "./bulk-select-checkbox";
import { BulkActionBar } from "./bulk-action-bar";
import {
  captureFilters,
  describeFilters,
  isCurrentView,
  parseFilters,
  savedViewHref,
} from "./saved-view-filters";
import { SavedViewsPanel, type SavedViewSummary } from "./saved-views-panel";

type TeamMember = { id: string; full_name: string | null };

/** F066 — a saved view as it comes out of the table. `filters` is jsonb. */
type SavedViewRow = { id: string; name: string; filters: unknown };

// Next.js 16: searchParams is a Promise on App Router pages — same pattern as
// src/app/admin/audit-log/page.tsx.
type SearchParams = Promise<{
  owner?: string;
  q?: string;
  page?: string;
  // F053/F054/F056: multi-select writes a parameter more than once, so each of
  // these arrives as a string[] when several values are chosen and a string when
  // one is. filterValues() flattens both.
  city?: string | string[];
  country?: string | string[];
  status?: string | string[];
  type?: string | string[];
  tags?: string | string[];
  /** Funnel stage the breakdown counts. */
  stage?: string;
  /** Field the breakdown groups by, and which end of it to show. */
  sort?: string;
  dir?: string;
  /** F060/F061 — field the *list* is ordered on, and which way. Separate from
   * `sort`/`dir` above on purpose: that pair drives the breakdown card, and
   * both controls are on screen together. */
  listSort?: string;
  listDir?: string;
}>;

const PAGE_SIZE = 25;

/**
 * The list's column track, shared by the header row and every row under it, so
 * the two can't drift apart. Columns only exist from `lg`: below that the row
 * folds back into name-over-subline, which is the only thing that fits.
 */
const ROW_GRID =
  "lg:grid lg:grid-cols-[2rem_minmax(0,1fr)_9rem_10rem_10rem_1rem] lg:items-center lg:gap-4";

/** Reserved width for the claim button, held whether or not the row has one. */
const CLAIM_SLOT = "w-[8.5rem] shrink-0";
/** Reserved width for the booklet link, held whether or not the row has one. */
const BOOKLET_SLOT = "w-[7rem] shrink-0";

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
 * F052 (#54) search by organisation name: `q` was already read here, but as part
 * of a GET form, so applying or clearing it meant a full document reload — AC4
 * asks for neither. The bar now soft-navigates on submit (Enter or click) via
 * router.replace; this page keeps reading `q` from the URL exactly as before,
 * so pagination, deep links and searchClients() are unchanged. Search fires on
 * submit rather than per keystroke by design: deliberate over twitchy.
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

  const {
    owner: ownerFilter,
    q: search,
    page: pageParam,
    tags: tagsParam,
    city,
    country,
    status,
    type: typeFilter,
    stage: stageParam,
    sort: sortParam,
    dir: dirParam,
    listSort: listSortParam,
    listDir: listDirParam,
  } = await searchParams;

  const supabase = await createClient();
  const canClaim = hasPermission(authorization.actor.role, "client:edit");
  const canGenerateBooklet = hasPermission(authorization.actor.role, "client:contact");
  /**
   * F062 AC1 names the CAM: "CAM can select multiple individual clients from the
   * list via checkboxes". Selection was gated on `isAdmin`, so the role the whole
   * Client Database batch is built for saw no checkboxes at all.
   *
   * Selection itself grants nothing — it is a way of pointing at rows — so it is
   * offered to anyone who can act on a client (`client:edit`, i.e. CAMs and
   * admins) rather than to admins alone. A viewer, who can only read, still gets
   * none. What you may then *do* with a selection stays permission-checked
   * separately: the bulk assign action below is still admin-only, because
   * reassigning ownership needs `ownership:reassign`.
   */
  const canSelect = hasPermission(authorization.actor.role, "client:edit");
  const canBulkAssign = hasPermission(authorization.actor.role, "ownership:reassign");

  const [organisations, openSuppressions, team, savedViews, allTags] = await Promise.all([
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
    // F066 — this CAM's own saved views. The `user_id` filter is belt and braces:
    // the select policy (matrix §3.17) already scopes the table to auth.uid(), so
    // this query cannot see anyone else's views with or without it.
    supabase
      .from("saved_views")
      .select("id, name, filters")
      .eq("user_id", authorization.actor.id)
      .order("created_at", { ascending: false })
      .overrideTypes<SavedViewRow[], { merge: false }>(),
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
  // A saved-views read that fails costs the CAM their shortcuts, not their list, so
  // it is logged and the panel renders empty rather than taking the page down.
  if (savedViews.error) {
    await reportError(savedViews.error, { operation: "clients.page_saved_views" });
  }
  if (allTags.error) {
    await reportError(allTags.error, { operation: "clients.page_tags" });
  }

  const allVisibleClients = visibleClients(organisations.data ?? [], openSuppressions.data ?? []);
  
  // Place options come from the data — there is no list of every city a charity
  // could be in, and one that nothing is in would be a dead end (F053 AC3's
  // reasoning, applied to places).
  const uniqueCities = Array.from(
    new Set(allVisibleClients.map((c) => c.city).filter(Boolean)),
  ).sort() as string[];
  const uniqueCountries = Array.from(
    new Set(allVisibleClients.map((c) => c.country_code).filter(Boolean)),
  ).sort();

  // Type and status options come from the *defined* sets, not from the rows on
  // screen. F053 AC3 and F056 AC2 both ask for the options to match what the
  // column allows; deriving them from current data silently drops any value
  // nobody happens to be in, so a status would disappear from the filter exactly
  // when the list emptied of it — the moment you would want to check.
  const typeOptions = ORGANISATION_TYPES.map((value) => ({
    label: formatOrganisationType(value),
    value,
  }));
  const statusOptions = PIPELINE_STATUSES.map((value) => ({
    label: formatOutreachStatus(value),
    value,
  }));

  const cityValues = filterValues(city);
  const countryValues = filterValues(country);
  const statusValues = filterValues(status);
  const typeValues = filterValues(typeFilter);
  const tagFilter = filterValues(tagsParam);

  let matchingClients = allVisibleClients;
  matchingClients = filterByOwner(matchingClients, ownerFilter);
  matchingClients = filterByCity(matchingClients, cityValues);
  matchingClients = filterByCountry(matchingClients, countryValues);
  matchingClients = filterByStatus(matchingClients, statusValues);
  matchingClients = filterByType(matchingClients, typeValues);
  matchingClients = filterByTags(matchingClients, tagFilter);
  matchingClients = searchClients(matchingClients, search);
  const teamMembers = team.data ?? [];
  // The owner dropdown lists CAMs only (F163), but `?owner=` can name anyone who
  // holds clients — an admin, or a deactivated former member — because the team
  // table links straight to this page (F167). Falling back to the name carried on
  // the clients themselves keeps the filter chip visible, so the list always says
  // whose it is and can always be cleared.
  const ownerFilterLabel =
    ownerFilter && ownerFilter !== "unassigned"
      ? (teamMembers.find((member) => member.id === ownerFilter)?.full_name ??
        allVisibleClients.find((client) => client.owner_id === ownerFilter)?.ownerName ??
        "Unnamed team member")
      : null;
  const availableTags = allTags.data ?? [];
  const filterActive = Boolean(
    ownerFilter ||
      search ||
      cityValues.length ||
      countryValues.length ||
      statusValues.length ||
      typeValues.length ||
      tagFilter.length,
  );
  // F166 AC1/AC3: this is the CAM viewing their own filter, not just any owner
  // filter — the heading, count label and empty state read "your clients" so the
  // view reads as its own thing rather than a generic filtered list.
  const isOwnedView =
    authorization.actor.role === "cam" && ownerFilter === authorization.actor.id;

  // F060/F061 — order the filtered set, then page it. Sorting after filtering
  // is what makes "sort combines with the active filters" true; sorting before
  // pagination is what makes it a sort of the list rather than of this page.
  // The funnel and breakdown above keep reading `matchingClients`: they count,
  // and a count doesn't care what order it was counted in.
  const listSortField = parseListSort(listSortParam);
  const listSortDirection = parseListDirection(listDirParam);
  const sortedClients = sortClients(matchingClients, listSortField, listSortDirection);

  /**
   * F066 (#68) — the filter combination this render was built from, and the CAM's
   * saved views measured against it.
   *
   * `activeFilters` is what "save this view" stores: the same params the list above
   * was filtered by (the multi-selects as the value arrays they filtered with),
   * captured through the shared whitelist so the page and the server action cannot
   * disagree about what a view is made of. `listSort`/`listDir` are deliberately
   * not part of a view — ordering is how the same list is read, not what is in it.
   *
   * A view whose filters equal the active ones is marked as showing — that is the
   * only thing this page interprets about a saved view. Everything else about it is
   * a link built from what it stored.
   */
  const activeFilters = captureFilters({
    q: search,
    city: cityValues,
    country: countryValues,
    status: statusValues,
    type: typeValues,
    owner: ownerFilter,
  });
  const savedViewSummaries: SavedViewSummary[] = (savedViews.data ?? []).map((row) => {
    const filters = parseFilters(row.filters);
    // The owner filter stores a user id. Name it from the team list, or say "you"
    // when it is the caller — an admin filtering to themselves is not in that list
    // (it is CAMs only), and reading "a former team member" about yourself is worse
    // than the raw id it replaces.
    const ownerName =
      filters.owner === authorization.actor.id
        ? "You"
        : (teamMembers.find((member) => member.id === filters.owner)?.full_name ??
          allVisibleClients.find((client) => client.owner_id === filters.owner)?.ownerName ??
          null);
    return {
      id: row.id,
      name: row.name,
      filters,
      href: savedViewHref(filters),
      description: describeFilters(filters, ownerName),
      isCurrent: isCurrentView(filters, activeFilters),
    };
  });

  const totalPages = Math.max(1, Math.ceil(matchingClients.length / PAGE_SIZE));
  const requestedPage = Number.parseInt(pageParam ?? "1", 10);
  const currentPage = Number.isInteger(requestedPage)
    ? Math.min(Math.max(requestedPage, 1), totalPages)
    : 1;
  const clients = sortedClients.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  );

  /**
   * Every link on this page is the current URL with one thing changed, so they
   * all go through here rather than each rebuilding the query string and quietly
   * dropping the parameters it doesn't know about. `undefined` clears a key.
   */
  type HrefValue = string | number | string[] | undefined;
  const hrefWith = (changes: Record<string, HrefValue>) => {
    const base: Record<string, HrefValue> = {
      owner: ownerFilter,
      q: search,
      // The multi-select filters carry every selected value, so a link that
      // changes the sort keeps all three chosen cities rather than the first.
      city: cityValues,
      country: countryValues,
      status: statusValues,
      type: typeValues,
      tags: tagFilter,
      stage: stageParam,
      sort: sortParam,
      dir: dirParam,
      // The parsed values, not the raw params: a pasted `?listSort=banana`
      // renders as name/ascending, and every link this page generates then
      // carries the canonical value, so the junk leaves the URL on the next
      // click instead of propagating forever.
      listSort: listSortField,
      listDir: listSortDirection,
      // Not carried over: a link that changes what the list holds has to start at
      // page one. Pagination opts back in explicitly.
      page: undefined,
      ...changes,
    };

    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(base)) {
      if (value === undefined || value === "") continue;
      if (key === "page" && Number(value) <= 1) continue;
      // A multi-value filter is repeated, not comma-joined: `append` keeps values
      // that contain a comma intact, and Next hands the repeats back as an array.
      if (Array.isArray(value)) {
        value.forEach((entry) => params.append(key, entry));
        continue;
      }
      params.set(key, String(value));
    }
    const qs = params.toString();
    return qs ? `/clients?${qs}` : "/clients";
  };

  const pageHref = (targetPage: number) => hrefWith({ page: targetPage });

  // The insight band reads the list you are actually looking at: filter to your
  // own clients and the funnel is yours, not the platform's. `caption` says which
  // of the two it is, so the numbers are never ambiguous.
  const stage: FunnelStageKey = parseStage(stageParam);
  const breakdownField = parseField(sortParam);
  const breakdownDirection = parseDirection(dirParam);
  const funnel = pipelineFunnel(matchingClients);
  // Every group carries all four stage counts, so the table reads across as that
  // group's own funnel; `stage` only decides which column the top three is
  // ranked on. Grouped by owner the list is not a top three at all (F167 AC1):
  // every owner is shown, so the panel is the whole team's workload.
  const breakdownRows = breakdown(
    matchingClients,
    breakdownField,
    breakdownDirection,
    stage,
    breakdownLimit(breakdownField),
  );
  const funnelCaption = filterActive
    ? `${matchingClients.length.toLocaleString()} filtered`
    : "All clients";
  // A group's row lands on the list filtered to that group, from page one. The
  // funnel stage rides along: it only ever counts the panels, never the list, so
  // "converted, by city" stays selected while the list narrows to that city.
  // A group's row narrows the list to that group alone, replacing whatever was
  // selected for that filter rather than adding to it — the row means "show me
  // this one", and a click that quietly widened the list would be a surprise.
  const rowHref = (filter: NonNullable<BreakdownRow["filter"]>) =>
    hrefWith({ [filter.param]: [filter.value] });
  const stageHref = (key: FunnelStageKey) =>
    hrefWith({ stage: key === "all" ? undefined : key });

  // F255 step 2 — "review your assigned clients" is complete when the CAM has looked
  // at their own list, which is this page filtered to themselves. Recording it here
  // rather than on the guide's link means the step reflects what they did, not what
  // they clicked. Anyone else's filtered list, or the unfiltered one, records nothing.
  const reviewingOwnClients = ownerFilter === authorization.actor.id;

  return (
    <BulkSelectProvider>
      <div className="min-h-screen bg-[#f4f4ef] px-6 py-10 sm:px-10 sm:py-12">
        {reviewingOwnClients && <RecordOnboardingStep step="review_clients" />}
        <SearchRail
          className="max-w-6xl"
          headingClassName="mb-8"
          bar={
            <BrandSearchBar
              defaultQuery={search ?? ""}
              defaultFilters={[
                // One chip per selected value, so a three-city filter reads as
                // three removable chips rather than one that hides the others.
                ...cityValues.map((value) => ({ category: "Filter by city", label: value, value })),
                ...countryValues.map((value) => ({ category: "Filter by country", label: value, value })),
                ...statusValues.map((value) => ({
                  category: "Filter by outreach status",
                  label: formatOutreachStatus(value),
                  value,
                })),
                ...typeValues.map((value) => ({
                  category: "Filter by organisation type",
                  label: formatOrganisationType(value),
                  value,
                })),
                ...(ownerFilter === "unassigned" ? [{ category: "Filter by owner", label: "Unassigned", value: "unassigned" }] : []),
                ...(ownerFilterLabel ? [{ category: "Filter by owner", label: ownerFilterLabel, value: ownerFilter as string }] : []),
                ...tagFilter.map(t => {
                   const tag = availableTags.find(x => x.id === t);
                   return { category: "Filter by tag", label: tag ? tag.name : t, value: t };
                })
              ]}
              params={{
                "Filter by city": "city",
                "Filter by country": "country",
                "Filter by outreach status": "status",
                "Filter by organisation type": "type",
                "Filter by owner": "owner",
                "Filter by tag": "tags",
              }}
              categories={{
                "Filter by city": uniqueCities.map(c => ({ label: c, value: c })),
                "Filter by country": uniqueCountries.map(c => ({ label: c, value: c })),
                "Filter by outreach status": statusOptions,
                "Filter by organisation type": typeOptions,
                "Filter by owner": [
                  { label: "Unassigned", value: "unassigned" },
                  ...teamMembers.map(m => ({ label: m.full_name || "Unnamed CAM", value: m.id }))
                ],
                "Filter by tag": availableTags.map(t => ({ label: t.name, value: t.id }))
              }}
            />
          }
          heading={
            <>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h1 className="text-[clamp(2rem,4vw,2.75rem)] font-semibold font-body leading-[1] tracking-[-0.03em]">
                  {isOwnedView ? "My clients" : "Clients"}
                </h1>
                {canClaim && (
                  <OriginButton
                    href="/clients/new"
                    size="md"
                  >
                    Add client manually
                  </OriginButton>
                )}
              </div>
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
              <InlineAlert
                variant="page"
                className="mb-8"
                message="Some data could not be loaded. Refresh and try again."
              />
            </Rise>
          )}

          <Group className="space-y-4">
            {/* F066 — the CAM's saved filter combinations, above the report they
                change. Selecting one is a link; saving one posts the filters this
                render used. */}
            <Rise>
              <SavedViewsPanel
                views={savedViewSummaries}
                activeFilters={activeFilters}
                hasActiveFilters={filterActive}
              />
            </Rise>

            {/* Where the pipeline stands before the list of it: the four stage
                totals, the stream between them, and the grouped breakdown under
                them — a top three, or every owner when grouped by owner. Counts
                whatever the list is currently showing. */}
            <Rise>
              <PipelineReport
                stages={funnel}
                selected={stage}
                stageHref={stageHref}
                caption={funnelCaption}
                field={breakdownField}
                direction={breakdownDirection}
                rows={breakdownRows}
                rowsLabel={breakdownField === "owner" ? "Every owner" : undefined}
                rowHref={rowHref}
              />
            </Rise>

            {matchingClients.length > 0 && (
              <Rise className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 pt-4">
                <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/35">
                  {matchingClients.length} client{matchingClients.length === 1 ? "" : "s"}
                  {isOwnedView ? " you own" : ""}
                </p>
                {/* F060/F061 — the list's own sort. Same sentence control the
                    breakdown card uses, on its own pair of params, sitting on
                    the line that already introduces the list. Shown at every
                    width: the column headers below it are lg-only. */}
                <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/35">
                  Sorted by{" "}
                  <ListSortMenu
                    param="listSort"
                    value={listSortField}
                    ariaLabel="Sort the client list by"
                    options={LIST_SORT_FIELDS.map((entry) => ({
                      value: entry.key,
                      label: entry.label,
                    }))}
                  />
                  ,{" "}
                  <ListSortMenu
                    param="listDir"
                    value={listSortDirection}
                    ariaLabel="Sort direction for the client list"
                    options={LIST_SORT_DIRECTIONS.map((entry) => ({
                      value: entry,
                      label: entry,
                    }))}
                  />
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
                <EmptyState
                  message={emptyStateMessage({ isOwnedView, search, filterActive })}
                />
              ) : (
                <div className="overflow-hidden rounded-2xl border border-black/[0.06] bg-white shadow-sm">
                  {/* The column key, on the widths the rows use. Hidden below lg,
                      where the row folds back into name-over-subline. */}
                  <div
                    className="group/header hidden items-center gap-4 border-b border-black/[0.06] bg-black/[0.015] px-5 py-2.5 text-[10px] font-bold uppercase tracking-[0.12em] text-foreground/30 lg:flex"
                  >
                    {canSelect && (
                      <span className="flex w-6 shrink-0 items-center justify-center">
                        {/* F062 AC1 asks for "all currently visible (filtered)
                            clients", which is the whole filtered set, not the 25
                            of it this page happens to show. Passing the paginated
                            slice made "select all" mean "select this page", so a
                            bulk action on a 60-client filter silently touched 25. */}
                        <SelectAllCheckbox clientIds={matchingClients.map((c) => c.id)} />
                      </span>
                    )}
                    <span className={`${ROW_GRID} min-w-0 flex-1`}>
                      <span />
                      <span>Client</span>
                      <span>Location</span>
                      <span>Status</span>
                      <span>Owner</span>
                      <span />
                    </span>
                    {(canGenerateBooklet || canClaim) && (
                      <span className="flex shrink-0 items-center gap-2">
                        {canGenerateBooklet && <span className={BOOKLET_SLOT} />}
                        {canClaim && <span className={CLAIM_SLOT} />}
                      </span>
                    )}
                  </div>

                  <ul>
                    {clients.map((client, index) => (
                      <li
                        key={client.id}
                        className="group/row flex items-center gap-4 border-b border-black/[0.06] px-5 py-3.5 last:border-b-0"
                      >
                        {canSelect && (
                          <span className="flex w-6 shrink-0 items-center justify-center">
                            <ClientRowCheckbox
                              organisationId={client.id}
                              legalName={client.legal_name}
                            />
                          </span>
                        )}
                        <Link
                          className={`group -m-2 min-w-0 flex-1 rounded-xl p-2 transition-colors hover:bg-black/[0.02] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand flex items-center gap-4 ${ROW_GRID}`}
                          href={`/clients/${client.id}`}
                        >
                          <span
                            aria-hidden="true"
                            className="w-6 shrink-0 text-[11px] font-bold tabular-nums text-foreground/25 lg:w-auto"
                          >
                            {String((currentPage - 1) * PAGE_SIZE + index + 1).padStart(2, "0")}
                          </span>

                          <span className="min-w-0 flex-1 lg:flex-none">
                            {/* Two lines on a phone rather than a hard truncate:
                                "1066 BATTL…" identifies nothing, and the column is
                                ~200px once the claim button has its share. */}
                            <span className="line-clamp-2 text-[15px] font-bold sm:block sm:truncate">
                              {client.legal_name}
                            </span>
                            {/* Below lg the row has no columns, so the subline
                                carries what those columns would have said. */}
                            <span className="block truncate text-sm text-foreground/50 lg:hidden">
                              {client.organisation_type} · {client.location}
                            </span>
                            <span className="hidden truncate text-[12px] text-foreground/40 lg:block">
                              {SOURCE_LABELS[client.organisation_type] ?? client.organisation_type}
                            </span>
                          </span>

                          <span className="hidden min-w-0 truncate text-[13px] text-foreground/60 lg:block">
                            {client.location}
                          </span>

                          <span className="hidden min-w-0 lg:block">
                            <span className="inline-block max-w-full truncate rounded-full bg-black/[0.05] px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.08em] text-foreground/55">
                              {client.outreachStatusLabel}
                            </span>
                            {client.suppressionPending && (
                              <span className="mt-1 block max-w-full truncate rounded-full bg-amber-50 px-2.5 py-1 text-center text-[11px] font-bold uppercase tracking-[0.08em] text-amber-800">
                                Suppression requested
                              </span>
                            )}
                          </span>

                          <span className="hidden min-w-0 lg:block">
                            <ClientOwnerBadge
                              ownerId={client.owner_id}
                              ownerName={client.ownerName}
                            />
                          </span>

                          {/* Between sm and lg there are no columns but there is
                              room for the two pills that matter. */}
                          <span className="hidden shrink-0 items-center gap-2 sm:flex lg:hidden">
                            <span className="rounded-full bg-black/[0.05] px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.08em] text-foreground/55">
                              {client.outreachStatusLabel}
                            </span>
                            <ClientOwnerBadge
                              ownerId={client.owner_id}
                              ownerName={client.ownerName}
                            />
                            {client.suppressionPending && (
                              <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.08em] text-amber-800">
                                Suppression requested
                              </span>
                            )}
                          </span>
                        </Link>

                        {/* A fixed slot rather than a conditional child: an owned
                            row still reserves the width, so no column shifts as
                            the list changes hands. */}
                        {(canGenerateBooklet || canClaim) && (
                          <span className="flex shrink-0 items-center gap-2">
                            {canGenerateBooklet && (
                              <span className={`${BOOKLET_SLOT} flex justify-end`}>
                                <Link
                                  className="flex items-center gap-1 rounded-full border border-brand/30 px-3 py-1 text-xs font-bold text-brand transition-colors hover:bg-brand/10"
                                  href={`/clients/${client.id}?booklet=generate`}
                                >
                                  <Sparkles aria-hidden="true" className="h-3 w-3" />
                                  Booklet
                                </Link>
                              </span>
                            )}
                            {canClaim && (
                              <span className={`${CLAIM_SLOT} flex justify-end`}>
                                {!client.ownerName && (
                                  <ClaimButton compact organisationId={client.id} />
                                )}
                              </span>
                            )}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
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
        {canSelect && <BulkActionBar team={teamMembers} canAssign={canBulkAssign} />}
      </div>
    </BulkSelectProvider>
  );
}
