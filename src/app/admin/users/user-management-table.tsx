"use client";

import type { Dispatch, SetStateAction } from "react";
import Link from "next/link";

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
  admin: "bg-purple-100/70 text-purple-900 border-purple-200",
  cam: "bg-brand/10 text-brand-hover border-brand/20",
  viewer: "bg-blue-100/70 text-blue-900 border-blue-200",
};

export function UserManagementTable({
  users,
  // Kept for compatibility with TeamPanel's lifted state (F011). This view is now
  // read-only for roles — changes happen on /team/[id] instead — so setUsers and
  // currentUserId are no longer used here but remain in the prop contract.
  setUsers: _setUsers,
  currentUserId: _currentUserId,
}: {
  users: TeamUser[];
  setUsers: Dispatch<SetStateAction<TeamUser[]>>;
  currentUserId: string;
}) {
  // Intentionally unused — see comment above.
  void _setUsers;
  void _currentUserId;

  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-black/10">
            <th className="p-3 pb-4 text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/40">Member</th>
            <th className="p-3 pb-4 text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/40">Role</th>
            <th className="p-3 pb-4 text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/40">Clients</th>
            <th className="p-3 pb-4 text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/40">Last active</th>
            <th className="p-3 pb-4 text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/40"></th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => {
            const roleLabel = ROLE_LABEL[user.role] ?? user.role;
            const roleStyle = ROLE_STYLES[user.role] ?? "bg-black/5 text-foreground/75 border-black/10";
            return (
              <tr className="border-b border-black/5" key={user.id}>
                <td className="p-3">
                  <Link
                    href={`/team/${user.id}`}
                    className="block font-bold hover:text-brand hover:underline"
                  >
                    {user.full_name ?? "Unnamed user"}
                  </Link>
                  <span className="text-foreground/60">{user.email}</span>
                </td>
                <td className="p-3">
                  <span
                    aria-label={`Role for ${user.email}: ${roleLabel}`}
                    title="Change role on the member's profile page"
                    className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-bold uppercase tracking-wide ${roleStyle}`}
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
  );
}
