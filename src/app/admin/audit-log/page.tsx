import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentActor } from "@/lib/auth/actor";
import { adminRouteDestination } from "@/lib/auth/admin-route";
import { reportError } from "@/lib/error-logging";
import { BrandSearchBar } from "@/components/brand/search-bar";
import { Group, Rise } from "@/components/dashboard-stage";
import { SearchRail } from "@/components/search-rail";
import {
  AUDIT_ACTIONS,
  describeAuditEvent,
  groupByDay,
  humaniseToken,
  matchesAuditQuery,
  type AuditRow,
} from "@/lib/audit-log-format";
import { AuditFeed } from "./audit-feed";

type UserOption = { id: string; email: string; full_name: string | null };
type OrganisationOption = { id: string; legal_name: string };

// Next.js 16: searchParams is a Promise on App Router pages, not a plain
// object (that changed from older versions). Same pattern already merged in
// src/app/login/page.tsx and src/app/reset-password/page.tsx.
type SearchParams = Promise<{ actor?: string; org?: string; action?: string; q?: string }>;

/**
 * How many entries one visit reads. The trail is append-only and unbounded, so
 * this is a window, not the whole thing — the page says so rather than implying
 * the list is complete.
 */
const WINDOW = 200;

/** Category label → query parameter, for the shared brand search bar. */
const FILTER_PARAMS = {
  "Filter by person": "actor",
  "Filter by client": "org",
  "Filter by action": "action",
} as const;

/**
 * F221 — the admin's read-only view of `audit_log`.
 *
 * Rebuilt onto the design system (docs/design-system.md). The app keeps the
 * shadcn tokens rather than the public palette — that exemption is in the doc —
 * but takes the system's *character*, the same way /dashboard and /clients do:
 * bone ground with white cards floating on it, a display heading against 11px
 * labels with nothing in between, one accent, and a staged blur-up entrance from
 * the shared brand variants.
 *
 * The substance of the rebuild is that the page no longer shows the database's
 * own vocabulary. It used to print `invite_cancelled`, a uuid for the person who
 * did it, `organisations / <uuid>` for what it was about, and the raw JSON — all
 * of which are correct and none of which can be read. Every one of those is now
 * resolved to a name or a sentence in `src/lib/audit-log-format.ts`, and the raw
 * form is one click away on the row.
 *
 * The root element is a `div`, not a `main`: the admin layout's AppShell already
 * renders the `main` this is slotted into.
 */
export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const authorization = await getCurrentActor("user:manage", {
    route: "/admin/audit-log",
  });
  if (!authorization.ok) redirect(adminRouteDestination(authorization.reason));

  const supabase = await createClient();

  const { actor: actorFilter, org: orgFilter, action: actionFilter, q: search } = await searchParams;

  // RLS also restricts this SELECT to admins (audit_log_select_admin), so a
  // bug in the getCurrentActor check above cannot leak rows to a non-admin —
  // this query fails closed on its own.
  let query = supabase
    .from("audit_log")
    .select("id, actor_user_id, action, target_table, target_id, detail, created_at")
    .order("created_at", { ascending: false })
    .limit(WINDOW);

  if (actorFilter) {
    query = query.eq("actor_user_id", actorFilter);
  }
  if (orgFilter) {
    query = query.eq("target_table", "organisations").eq("target_id", orgFilter);
  }
  if (actionFilter) {
    query = query.eq("action", actionFilter);
  }

  // overrideTypes is the current @supabase/postgrest-js method for this — it
  // replaced the older .returns<T>(), which is now the deprecated one. See
  // node_modules/@supabase/postgrest-js/src/PostgrestTransformBuilder.ts.
  const { data: rows, error } = await query.overrideTypes<AuditRow[], { merge: false }>();

  if (error) {
    // Fail visibly per the project SOP, but never show the raw database error
    // to the user — it can describe internal shape (column/constraint names)
    // that isn't this project's convention to expose.
    await reportError(error, { operation: "admin.audit_log.page_list" });
  }

  // The clients this window actually mentions, so the page can name them.
  //
  // Deliberately not "every organisation": there are already well over a
  // thousand, and PostgREST caps an unbounded select at 1000 rows — so the old
  // version of this page silently failed to resolve, and silently omitted from
  // its filter, any client past the first thousand alphabetically. Asking for
  // the handful of ids on screen is both correct and cheaper. `orgFilter` is
  // included so its chip still has a name when the filter matches nothing.
  const referencedOrgIds = Array.from(
    new Set(
      [
        ...(rows ?? [])
          .filter((row) => row.target_table === "organisations" && row.target_id)
          .map((row) => row.target_id as string),
        ...(orgFilter ? [orgFilter] : []),
      ].filter(Boolean),
    ),
  );

  // Both tables are readable by any active user (see their own RLS policies), so
  // no extra permission check is needed beyond the admin gate already passed
  // above. `users` is the team, bounded by headcount, so it is read whole — the
  // person filter has to offer someone whose last action fell outside the window.
  const [{ data: userOptions }, { data: orgOptions }] = await Promise.all([
    supabase
      .from("users")
      .select("id, email, full_name")
      .order("email")
      // Same overrideTypes note as above — current method, not deprecated.
      .overrideTypes<UserOption[], { merge: false }>(),
    referencedOrgIds.length > 0
      ? supabase
          .from("organisations")
          .select("id, legal_name")
          .in("id", referencedOrgIds)
          .order("legal_name")
          .overrideTypes<OrganisationOption[], { merge: false }>()
      : Promise.resolve({ data: [] as OrganisationOption[] }),
  ]);

  const people = new Map((userOptions ?? []).map((option) => [option.id, option.full_name?.trim() || option.email]));
  const clients = new Map((orgOptions ?? []).map((option) => [option.id, option.legal_name]));

  const resolvers = {
    user: (id: string) => people.get(id) ?? null,
    organisation: (id: string) => clients.get(id) ?? null,
  };

  // One clock for the whole page, so two rows a millisecond apart cannot end up
  // in different day groups or disagree about what "an hour ago" means.
  const now = new Date();
  const described = (rows ?? []).map((row) => describeAuditEvent(row, resolvers, now));

  // Free text is matched against the *rendered* row rather than pushed into the
  // query: someone searching "invite cancelled" is reading this page, not the
  // database, and Postgres has never heard that phrase. It therefore filters
  // within the window above, which the footer states plainly.
  const events = search ? described.filter((event) => matchesAuditQuery(event, search)) : described;
  const groups = groupByDay(events);

  const filtersActive = Boolean(actorFilter || orgFilter || actionFilter || search);
  const actorsInvolved = new Set(events.map((event) => event.actorId ?? "system")).size;

  // Every action this app can write, plus anything already in the window that
  // predates the vocabulary — so a token added by a future RPC is filterable the
  // day it first appears, whether or not it has been given nice copy yet.
  const actionTokens = Array.from(
    new Set([...Object.keys(AUDIT_ACTIONS), ...described.map((event) => event.action)]),
  );

  return (
    <div className="min-h-screen bg-[#f4f4ef] px-6 py-10 sm:px-10 sm:py-12">
      <SearchRail
        className="max-w-6xl"
        stageClassName="space-y-10"
        heading={
          <>
            <h1 className="text-[clamp(2rem,4vw,2.75rem)] font-semibold font-body leading-[1] tracking-[-0.03em]">
              Audit log
            </h1>
            <p className="mt-3 max-w-xl text-sm leading-[1.7] text-foreground/65">
              Every recorded action, most recent first. Append-only — this trail can
              never be edited or deleted, only added to. Open a row for the exact
              stamp and the ids behind it.
            </p>
          </>
        }
        bar={
            <BrandSearchBar
              placeholder="Search the trail for"
              subjects={["actions", "people", "clients", "changes"]}
              defaultQuery={search ?? ""}
              params={FILTER_PARAMS}
              defaultFilters={[
                ...(actorFilter
                  ? [
                      {
                        category: "Filter by person",
                        label: people.get(actorFilter) ?? "Unknown person",
                        value: actorFilter,
                      },
                    ]
                  : []),
                ...(orgFilter
                  ? [
                      {
                        category: "Filter by client",
                        label: clients.get(orgFilter) ?? "Unknown client",
                        value: orgFilter,
                      },
                    ]
                  : []),
                ...(actionFilter
                  ? [
                      {
                        category: "Filter by action",
                        label: AUDIT_ACTIONS[actionFilter]?.label ?? humaniseToken(actionFilter),
                        value: actionFilter,
                      },
                    ]
                  : []),
              ]}
              categories={{
                "Filter by person": (userOptions ?? []).map((option) => ({
                  label: option.full_name?.trim() || option.email,
                  value: option.id,
                })),
                "Filter by client": (orgOptions ?? []).map((option) => ({
                  label: option.legal_name,
                  value: option.id,
                })),
                "Filter by action": actionTokens
                  .map((token) => ({
                    label: AUDIT_ACTIONS[token]?.label ?? humaniseToken(token),
                    value: token,
                  }))
                  .sort((a, b) => a.label.localeCompare(b.label)),
              }}
            />
        }
      >
        {error ? (
          <Rise>
            <p
              role="alert"
              className="rounded-2xl border border-destructive/20 bg-destructive/[0.06] px-5 py-4 text-sm font-bold text-destructive"
            >
              Something went wrong loading the audit log. This has been recorded —
              try again shortly.
            </p>
          </Rise>
        ) : (
          <Group className="space-y-4">
            <Rise className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
              <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/35">
                <span className="tabular-nums">{events.length}</span> event
                {events.length === 1 ? "" : "s"}
                {filtersActive ? " matching" : ""}
                {events.length > 0 && (
                  <>
                    {" · "}
                    <span className="tabular-nums">{actorsInvolved}</span>{" "}
                    {actorsInvolved === 1 ? "person" : "people"} involved
                  </>
                )}
              </p>
              {described.length === WINDOW && (
                <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/25">
                  Most recent {WINDOW} entries
                </p>
              )}
            </Rise>

            {events.length > 0 ? (
              <AuditFeed groups={groups} />
            ) : (
              <Rise>
                <div className="rounded-2xl border border-black/[0.06] bg-white px-5 py-10 shadow-sm">
                  <p className="text-center text-sm leading-[1.7] text-foreground/65">
                    {filtersActive
                      ? "Nothing in the trail matches this filter."
                      : "Nothing has been logged yet. Actions appear here the moment someone changes ownership, a status, a role, or an approval."}
                  </p>
                </div>
              </Rise>
            )}
          </Group>
        )}
      </SearchRail>
    </div>
  );
}
