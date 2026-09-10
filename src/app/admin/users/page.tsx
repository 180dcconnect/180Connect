import { redirect } from "next/navigation";
import { getCurrentActor } from "@/lib/auth/actor";
import { adminRouteDestination } from "@/lib/auth/admin-route";
import { createClient } from "@/lib/supabase/server";
import { reportError } from "@/lib/error-logging";
import { InlineAlert } from "@/components/ui/inline-alert";
import type { PendingInvite } from "@/lib/admin/team-realtime";
import { TeamPanel } from "./team-panel";
import type { TeamUser } from "./user-management-table";
import { Rise } from "@/components/dashboard-stage";
import { SearchRail } from "@/components/search-rail";
import { BrandSearchBar } from "@/components/brand/search-bar";
import { DarkInviteSheet } from "./invite-sheet-dark";
import { allowedEmailDomains } from "@/lib/auth/email-domain";
import {
  CLIENT_COUNT_FILTER_OPTIONS,
  LAST_ACTIVE_FILTER_OPTIONS,
  parseArrayParam,
  ROLE_FILTER_OPTIONS,
  STATUS_FILTER_OPTIONS,
  TEAM_SEARCH_CATEGORIES,
  TEAM_SEARCH_PARAMS,
  type TeamFilterCriteria,
} from "@/lib/admin/team-filter";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  const authorization = await getCurrentActor("user:manage", {
    route: "/admin/users",
  });
  if (!authorization.ok) redirect(adminRouteDestination(authorization.reason));

  const resolvedParams = searchParams ? await searchParams : {};
  const query = typeof resolvedParams.q === "string" ? resolvedParams.q : "";
  const roleValues = parseArrayParam(resolvedParams.role);
  const clientValues = parseArrayParam(resolvedParams.clients);
  const lastActiveValues = parseArrayParam(resolvedParams.last_active);
  const statusValues = parseArrayParam(resolvedParams.status);

  const roleLabelMap = new Map(ROLE_FILTER_OPTIONS.map((o) => [o.value, o.label]));
  const clientLabelMap = new Map(CLIENT_COUNT_FILTER_OPTIONS.map((o) => [o.value, o.label]));
  const lastActiveLabelMap = new Map(LAST_ACTIVE_FILTER_OPTIONS.map((o) => [o.value, o.label]));
  const statusLabelMap = new Map(STATUS_FILTER_OPTIONS.map((o) => [o.value, o.label]));

  const defaultFilters = [
    ...roleValues.map((value) => ({
      category: "Filter by role",
      label: roleLabelMap.get(value) ?? value,
      value,
    })),
    ...clientValues.map((value) => ({
      category: "Filter by client load",
      label: clientLabelMap.get(value) ?? value,
      value,
    })),
    ...lastActiveValues.map((value) => ({
      category: "Filter by last active",
      label: lastActiveLabelMap.get(value) ?? value,
      value,
    })),
    ...statusValues.map((value) => ({
      category: "Filter by status",
      label: statusLabelMap.get(value) ?? value,
      value,
    })),
  ];

  const filterCriteria: TeamFilterCriteria = {
    query,
    roles: roleValues,
    clientRanges: clientValues,
    lastActiveRanges: lastActiveValues,
    statuses: statusValues,
  };

  const supabase = await createClient();

  // Excludes rows with an invite still pending (invited_at set, not yet
  // accepted) — those are listed separately below, not mixed into the team
  // table, so the two lists stay mutually exclusive (F008 AC5).
  // F188: excludes the fixed placeholder account (see
  // create_deleted_user_placeholder_for_tags.sql) — a fake, never-active
  // row that exists purely as a foreign-key target so a tag survives its
  // real creator's account being deleted. It must never appear as if it
  // were a real team member.
  const DELETED_USER_PLACEHOLDER_ID = "00000000-0000-0000-0000-000000000001";

  // All four reads at once. None depends on another's result, so awaiting them
  // in sequence made this page four round trips deep for no reason; the errors
  // are still reported individually below, exactly as before.
  //
  // Owned-client counts drive the reassignment gate's warning (F014 AC2), so the
  // admin sees "owns 3 clients" before starting rather than being refused after.
  // Fetched separately because PostgREST cannot aggregate across the reverse of
  // this FK in one select. A failure there is not fatal: deactivate_user recounts
  // authoritatively.
  //
  // F167: the count in the table links through to /clients?owner=, and that list
  // hides actively-suppressed clients (F051 AC4). Counting them here too would
  // send the admin to a list shorter than the number they clicked. Kept as a
  // second count rather than a narrower `owned` query: the reassignment gate
  // still has to see every client the leaver holds, suppressed or not.
  const [
    { data: users, error },
    { data: pendingInvites, error: pendingError },
    { data: owned, error: ownedError },
    { data: suppressed, error: suppressedError },
  ] = await Promise.all([
    supabase
      .from("users")
      .select("id, email, full_name, role, is_active, deactivated_at, last_seen_at")
      .or("invited_at.is.null,invite_accepted_at.not.is.null")
      .neq("id", DELETED_USER_PLACEHOLDER_ID)
      .order("full_name"),
    supabase
      .from("users")
      .select("id, email, invited_at, role")
      .not("invited_at", "is", null)
      .is("invite_accepted_at", null)
      .order("invited_at", { ascending: false }),
    supabase.from("organisations").select("id, owner_id").not("owner_id", "is", null),
    supabase.from("suppressions").select("organisation_id").eq("status", "active"),
  ]);

  if (error) {
    await reportError(error, { operation: "admin.users.page_list" });
  }
  if (pendingError) {
    await reportError(pendingError, { operation: "admin.users.pending_invites_list" });
  }
  if (ownedError) {
    await reportError(ownedError, { operation: "admin.users.page_owned_counts" });
  }
  if (suppressedError) {
    await reportError(suppressedError, { operation: "admin.users.page_suppressions" });
  }

  const suppressedOrgs = new Set((suppressed ?? []).map((row) => row.organisation_id));

  const ownedCounts = new Map<string, number>();
  const listedCounts = new Map<string, number>();
  for (const row of owned ?? []) {
    if (!row.owner_id) continue;
    ownedCounts.set(row.owner_id, (ownedCounts.get(row.owner_id) ?? 0) + 1);
    if (!suppressedOrgs.has(row.id)) {
      listedCounts.set(row.owner_id, (listedCounts.get(row.owner_id) ?? 0) + 1);
    }
  }

  const teamUsers: TeamUser[] = (users ?? []).map((user) => ({
    ...user,
    owned_client_count: ownedCounts.get(user.id) ?? 0,
    listed_client_count: listedCounts.get(user.id) ?? 0,
  })) as TeamUser[];

  return (
    <div className="min-h-screen bg-[#f4f4ef] px-6 py-10 sm:px-10 sm:py-12">
      <SearchRail
        className="max-w-6xl"
        stageClassName="space-y-10"
        heading={
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 className="text-[clamp(2rem,4vw,2.75rem)] font-semibold font-body leading-[1] tracking-[-0.03em]">
                Team members
              </h1>
            </div>
            <div className="shrink-0 pt-1">
              {/* Resolved here, not in the sheet: the allowlist lives in
                  AUTH_ALLOWED_EMAIL_DOMAIN, and process.env is not readable
                  from a Client Component. */}
              <DarkInviteSheet
                allowedDomains={allowedEmailDomains()}
                pendingEmails={(pendingInvites ?? []).map((p) => p.email)}
                existingUserEmails={(users ?? [])
                  .filter((u) => !u.deactivated_at && u.is_active !== false)
                  .map((u) => u.email)}
                deactivatedEmails={(users ?? [])
                  .filter((u) => Boolean(u.deactivated_at) || u.is_active === false)
                  .map((u) => u.email)}
              />
            </div>
          </div>
        }
        bar={
          <BrandSearchBar
            placeholder="Search team members for"
            subjects={["team members", "roles", "CAMs", "admins"]}
            defaultQuery={query}
            params={TEAM_SEARCH_PARAMS}
            categories={TEAM_SEARCH_CATEGORIES}
            defaultFilters={defaultFilters}
          />
        }
      >
        {error && (
          <Rise>
            <InlineAlert
              variant="page"
              message="Team members could not be loaded. Please refresh and try again."
            />
          </Rise>
        )}

        {!error && (
          <TeamPanel
            currentUserId={authorization.actor.id}
            filterCriteria={filterCriteria}
            initialPendingInvites={(pendingInvites as PendingInvite[] | null) ?? []}
            initialTeamUsers={teamUsers}
            pendingInvitesError={Boolean(pendingError)}
          />
        )}
      </SearchRail>
    </div>
  );
}
