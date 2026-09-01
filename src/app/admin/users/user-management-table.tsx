"use client";

import { useMemo, useState, type Dispatch, type SetStateAction } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, ArrowUpDown, X } from "lucide-react";
import { sortTeamUsers, type SortOrder, type TeamSortField } from "@/lib/admin/team-filter";

export type TeamUser = {
  id: string;
  email: string;
  full_name: string | null;
  role: "cam" | "admin" | "viewer";
  is_active: boolean;
  /**
   * F014. Null on an active account and on a merely suspended one; set when the
   * account was deactivated. `is_active` alone still decides whether they can log in —
   * this only says which kind of inactive they are.
   */
  deactivated_at: string | null;
  /** Last time this user was seen on any signed-in page — not last login. Null if never. */
  last_seen_at: string | null;
  owned_client_count: number;
  /**
   * F167. The subset of `owned_client_count` that /clients actually lists —
   * actively-suppressed clients are hidden there (F051 AC4). This is what the
   * Clients column links through to; `owned_client_count` stays the number the
   * reassignment gate reasons about, which has to include the suppressed ones.
   */
  listed_client_count: number;
};

/**
 * What the Clients cell promises before it is clicked. Suppressed clients are
 * owned but not listed, so they are named rather than silently missing from the
 * list the admin lands on.
 */
function clientsLinkTitle(user: TeamUser): string {
  const listed = user.listed_client_count;
  const hidden = user.owned_client_count - listed;
  const base = `View ${listed} client${listed === 1 ? "" : "s"} owned by ${displayName(user)}`;
  return hidden > 0
    ? `${base} (${hidden} more suppressed, not listed)`
    : base;
}

function displayName(user: TeamUser) {
  return user.full_name ?? user.email;
}

/**
 * "Last active" — not last login. `last_seen_at` is touched on every signed-in page
 * and admin API request (getCurrentActor), throttled to once per 5 minutes per user.
 */
function lastActiveLabel(lastSeenAt: string | null): string {
  if (!lastSeenAt) return "Never";
  const elapsedMs = Date.now() - new Date(lastSeenAt).getTime();
  if (elapsedMs < 60_000) return "Just now";
  const minutes = Math.floor(elapsedMs / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(lastSeenAt).toLocaleDateString();
}

const ROLE_LABEL: Record<TeamUser["role"], string> = {
  cam: "CAM",
  admin: "Admin",
  viewer: "Viewer",
};

const ROLE_STYLES: Record<TeamUser["role"], string> = {
  admin: "bg-[#f5efc6]/50 text-[#000000]/85 border-[#f5efc6]/20",
  cam: "bg-brand/10 text-brand-hover border-brand/10",
  viewer: "bg-[#f0f9ff] text-[#000000]/85 border-[#f0f9ff]",
};

export function UserManagementTable({
  users,
  totalCount,
  hasActiveFilters = false,
  // Kept for compatibility with TeamPanel's lifted state (F011). This view is now
  // read-only for roles — changes happen on /team/[id] instead — so setUsers and
  // currentUserId are no longer used here but remain in the prop contract.
  setUsers: _setUsers,
  currentUserId: _currentUserId,
}: {
  users: TeamUser[];
  totalCount?: number;
  hasActiveFilters?: boolean;
  setUsers: Dispatch<SetStateAction<TeamUser[]>>;
  currentUserId: string;
}) {
  // Intentionally unused — see comment above.
  void _setUsers;
  void _currentUserId;

  const [sortBy, setSortBy] = useState<TeamSortField>("name");
  const [sortOrder, setSortOrder] = useState<SortOrder>("asc");

  function handleSort(field: TeamSortField) {
    if (sortBy === field) {
      setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(field);
      setSortOrder(field === "clients" || field === "last_active" ? "desc" : "asc");
    }
  }

  const sortedUsers = useMemo(() => {
    return sortTeamUsers(users, sortBy, sortOrder);
  }, [users, sortBy, sortOrder]);

  const total = totalCount ?? users.length;
  const isFiltered = hasActiveFilters && total !== sortedUsers.length;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-black/[0.06] px-1 pb-4">
        <div className="text-xs font-semibold uppercase tracking-[0.12em] text-foreground/50">
          {isFiltered ? (
            <span>
              Showing <strong className="text-foreground">{sortedUsers.length}</strong> of{" "}
              <strong className="text-foreground">{total}</strong> members
            </span>
          ) : (
            <span>
              <strong className="text-foreground">{sortedUsers.length}</strong> team member
              {sortedUsers.length === 1 ? "" : "s"}
            </span>
          )}
        </div>

        {hasActiveFilters && (
          <Link
            href="/admin/users"
            className="inline-flex items-center gap-1.5 rounded-full border border-black/10 bg-black/[0.03] px-2.5 py-1 text-xs font-medium text-foreground/70 transition-colors hover:bg-black/8 hover:text-foreground"
          >
            <X className="h-3 w-3" />
            Reset all filters
          </Link>
        )}
      </div>

      {sortedUsers.length === 0 ? (
        <div className="py-12 text-center">
          <p className="text-sm text-foreground/60">
            {hasActiveFilters
              ? "No team members match the current search or filter criteria."
              : "No team members found."}
          </p>
          {hasActiveFilters && (
            <div className="mt-4">
              <Link
                href="/admin/users"
                className="inline-flex items-center justify-center rounded-xl bg-black/5 px-4 py-2 text-xs font-bold text-foreground transition-colors hover:bg-black/10"
              >
                Clear all filters
              </Link>
            </div>
          )}
        </div>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-black/10">
                <th className="p-3 pb-4">
                  <button
                    type="button"
                    onClick={() => handleSort("name")}
                    className="group inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/50 hover:text-foreground"
                  >
                    <span>Member</span>
                    {sortBy === "name" ? (
                      sortOrder === "asc" ? (
                        <ArrowUp className="h-3.5 w-3.5 text-foreground" />
                      ) : (
                        <ArrowDown className="h-3.5 w-3.5 text-foreground" />
                      )
                    ) : (
                      <ArrowUpDown className="h-3.5 w-3.5 opacity-0 transition-opacity group-hover:opacity-60" />
                    )}
                  </button>
                </th>
                <th className="p-3 pb-4">
                  <button
                    type="button"
                    onClick={() => handleSort("role")}
                    className="group inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/50 hover:text-foreground"
                  >
                    <span>Role</span>
                    {sortBy === "role" ? (
                      sortOrder === "asc" ? (
                        <ArrowUp className="h-3.5 w-3.5 text-foreground" />
                      ) : (
                        <ArrowDown className="h-3.5 w-3.5 text-foreground" />
                      )
                    ) : (
                      <ArrowUpDown className="h-3.5 w-3.5 opacity-0 transition-opacity group-hover:opacity-60" />
                    )}
                  </button>
                </th>
                <th className="p-3 pb-4">
                  <button
                    type="button"
                    onClick={() => handleSort("clients")}
                    className="group inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/50 hover:text-foreground"
                  >
                    <span>Clients</span>
                    {sortBy === "clients" ? (
                      sortOrder === "asc" ? (
                        <ArrowUp className="h-3.5 w-3.5 text-foreground" />
                      ) : (
                        <ArrowDown className="h-3.5 w-3.5 text-foreground" />
                      )
                    ) : (
                      <ArrowUpDown className="h-3.5 w-3.5 opacity-0 transition-opacity group-hover:opacity-60" />
                    )}
                  </button>
                </th>
                <th className="p-3 pb-4">
                  <button
                    type="button"
                    onClick={() => handleSort("last_active")}
                    className="group inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/50 hover:text-foreground"
                  >
                    <span>Last active</span>
                    {sortBy === "last_active" ? (
                      sortOrder === "asc" ? (
                        <ArrowUp className="h-3.5 w-3.5 text-foreground" />
                      ) : (
                        <ArrowDown className="h-3.5 w-3.5 text-foreground" />
                      )
                    ) : (
                      <ArrowUpDown className="h-3.5 w-3.5 opacity-0 transition-opacity group-hover:opacity-60" />
                    )}
                  </button>
                </th>
                <th className="p-3 pb-4 text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/40"></th>
              </tr>
            </thead>
            <tbody>
              {sortedUsers.map((user) => {
                const roleLabel = ROLE_LABEL[user.role] ?? user.role;
                const roleStyle =
                  ROLE_STYLES[user.role] ?? "bg-black/5 text-foreground/75 border-black/10";
                return (
                  <tr className="border-b border-black/5 transition-colors hover:bg-black/[0.015]" key={user.id}>
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        <div>
                          <Link
                            href={`/team/${user.id}`}
                            className="block font-bold hover:text-brand hover:underline"
                          >
                            {user.full_name ?? "Unnamed user"}
                          </Link>
                          <span className="text-foreground/60">{user.email}</span>
                        </div>
                        {!user.is_active && (
                          <span className="ml-2 rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-red-700">
                            Inactive
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="p-3">
                      <span
                        aria-label={`Role for ${user.email}: ${roleLabel}`}
                        title="Change role on the member's profile page"
                        className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-bold capitalize tracking-wide ${roleStyle}`}
                      >
                        {roleLabel}
                      </span>
                    </td>
                    <td className="p-3">
                      {user.listed_client_count > 0 ? (
                        <Link
                          href={`/clients?owner=${user.id}`}
                          className="font-bold text-brand hover:underline"
                          title={clientsLinkTitle(user)}
                        >
                          {user.listed_client_count}
                        </Link>
                      ) : (
                        <span className="text-foreground/40" title={clientsLinkTitle(user)}>
                          {user.listed_client_count}
                        </span>
                      )}
                    </td>
                    <td className="p-3 text-foreground/60">{lastActiveLabel(user.last_seen_at)}</td>
                    <td className="p-3">
                      <Link
                        href={`/team/${user.id}`}
                        className="inline-flex items-center justify-center rounded-lg border border-black/15 bg-white px-3 py-2 text-xs font-bold text-foreground hover:border-black/25 hover:bg-black/[0.02]"
                      >
                        View
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
