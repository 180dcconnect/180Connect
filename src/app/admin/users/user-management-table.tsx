"use client";

import { useState, type Dispatch, type SetStateAction } from "react";
import Link from "next/link";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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

type AccessState = "active" | "suspended" | "deactivated";

function accessState(user: TeamUser): AccessState {
  if (user.is_active) return "active";
  return user.deactivated_at ? "deactivated" : "suspended";
}

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

const ACCESS_LABEL: Record<AccessState, string> = {
  active: "Active",
  suspended: "Suspended",
  deactivated: "Deactivated",
};

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

export function UserManagementTable({
  users,
  setUsers,
  currentUserId,
}: {
  users: TeamUser[];
  /**
   * Lifted to team-panel.tsx (F011) so a realtime change from another admin and a
   * change this table just made through `/api/admin/users` land in the same state —
   * the panel's subscription and this table's PATCH calls would otherwise race to
   * overwrite each other's `setUsers`.
   */
  setUsers: Dispatch<SetStateAction<TeamUser[]>>;
  currentUserId: string;
}) {
  const [message, setMessage] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  /** The user an offboarding is being composed for, or null when the form is closed. */
  const [offboarding, setOffboarding] = useState<TeamUser | null>(null);

  /**
   * Re-reads the whole table. A reassignment changes a row the response does not
   * describe — the clients land on someone else, and their count in the Clients
   * column would otherwise stay stale until a manual refresh. Patching the two rows
   * by hand would go wrong the moment the RPC moves anything else (F257 will), so the
   * table is re-read from the source instead.
   */
  async function refreshUsers() {
    try {
      const response = await fetch("/api/admin/users");
      if (!response.ok) return;
      const result = await response.json();
      if (Array.isArray(result.users)) setUsers(result.users);
    } catch {
      // The change itself landed; a stale count is not worth an error message over.
    }
  }

  /**
   * One PATCH for every change a row supports: `{ role }` swaps the role (F012),
   * `{ isActive }` suspends or reactivates (F013), and `{ deactivate: true, ... }`
   * offboards (F014). The route reads whichever it is given and refuses anything
   * carrying none of them.
   */
  async function updateUser(
    userId: string,
    change:
      | { role: TeamUser["role"] }
      | { isActive: boolean }
      | {
          deactivate: true;
          reason: string;
          reassignTo?: string;
          releaseClients?: boolean;
        },
    successMessage: string,
  ) {
    setSavingId(userId);
    setMessage("");
    try {
      const response = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, ...change }),
      });
      const result = await response.json();
      if (!response.ok) {
        setMessage(result.error ?? "The change was blocked.");
        return false;
      }
      setUsers((current) =>
        current.map((user) =>
          user.id === userId
            ? { ...user, ...result.user, owned_client_count: 0, listed_client_count: 0 }
            : user,
        ),
      );
      setMessage(
        result.clientsMoved
          ? `${successMessage} ${result.clientsMoved} client${result.clientsMoved === 1 ? "" : "s"} moved.`
          : successMessage,
      );
      if (result.clientsMoved) await refreshUsers();
      return true;
    } catch {
      setMessage("The change could not be saved. Check your connection and try again.");
      return false;
    } finally {
      setSavingId(null);
    }
  }

  /**
   * Who a departing member's clients may be handed to. Viewers are excluded because
   * they may not own anything, and inactive accounts because handing work to one
   * recreates the problem this flow exists to solve. `deactivate_user` enforces both
   * again — this list only keeps the admin from picking something it will refuse.
   */
  const eligibleOwners = offboarding
    ? users.filter(
        (user) =>
          user.id !== offboarding.id &&
          user.is_active &&
          user.role !== "viewer",
      )
    : [];

  return (
    <>
      <p aria-live="polite" className="mb-2 min-h-5 text-sm font-bold">
        {message}
      </p>

      {offboarding && (
        <OffboardingForm
          eligibleOwners={eligibleOwners}
          onCancel={() => setOffboarding(null)}
          onConfirm={async (change) => {
            const ok = await updateUser(
              offboarding.id,
              { deactivate: true, ...change },
              `${displayName(offboarding)} has been deactivated. They have been signed out and can no longer log in.`,
            );
            if (ok) setOffboarding(null);
          }}
          saving={savingId === offboarding.id}
          user={offboarding}
        />
      )}

      <div className="mt-3 overflow-x-auto">
        <table className="w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-black/10">
              <th className="p-3 pb-4 text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/40">Member</th>
              <th className="p-3 pb-4 text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/40">Role</th>
              <th className="p-3 pb-4 text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/40">Clients</th>
              <th className="p-3 pb-4 text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/40">Last active</th>
              <th className="p-3 pb-4 text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/40">Status</th>
              <th className="p-3 pb-4 text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/40">Access</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => {
              const state = accessState(user);
              return (
                <tr className="border-b border-black/5" key={user.id}>
                  <td className="p-3">
                    <span className="block font-bold">{user.full_name ?? "Unnamed user"}</span>
                    <span className="text-foreground/60">{user.email}</span>
                    {user.role === "cam" && (
                      <span className="block mt-1">
                        <Link
                          href={`/admin/cam-settings?user=${user.id}`}
                          className="text-xs font-medium text-brand hover:underline"
                        >
                          Queue settings →
                        </Link>
                      </span>
                    )}
                  </td>
                  <td className="p-3">
                    <Select
                      disabled={savingId === user.id || user.id === currentUserId}
                      onValueChange={(value) =>
                        updateUser(
                          user.id,
                          { role: value as TeamUser["role"] },
                          "Role updated successfully.",
                        )
                      }
                      value={user.role}
                    >
                      <SelectTrigger aria-label={`Role for ${user.email}`} className="w-fit bg-white">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="cam">CAM</SelectItem>
                        <SelectItem value="admin">Admin</SelectItem>
                        <SelectItem value="viewer">Viewer</SelectItem>
                      </SelectContent>
                    </Select>
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
                    <span
                      className={
                        state === "active"
                          ? "font-bold text-brand"
                          : "font-bold text-red-700"
                      }
                    >
                      {ACCESS_LABEL[state]}
                    </span>
                  </td>
                  <td className="p-3">
                    {/*
                      Acting on yourself is refused by both RPCs and by the route before
                      them; the buttons are hidden rather than disabled because there is
                      no state in which an admin can press them.
                    */}
                    {user.id === currentUserId ? (
                      <span className="text-foreground/50">—</span>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {state !== "deactivated" && (
                          <button
                            className={
                              user.is_active
                                ? "rounded-lg border border-red-700/40 px-3 py-2 font-bold text-red-700 disabled:opacity-50"
                                : "rounded-lg border border-black/15 px-3 py-2 font-bold disabled:opacity-50"
                            }
                            disabled={savingId === user.id}
                            onClick={() =>
                              updateUser(
                                user.id,
                                { isActive: !user.is_active },
                                user.is_active
                                  ? "Team member suspended. They have been signed out and can no longer log in."
                                  : "Team member reactivated. They can log in again.",
                              )
                            }
                            type="button"
                          >
                            {user.is_active ? "Suspend" : "Reactivate"}
                          </button>
                        )}
                        {state === "deactivated" ? (
                          <button
                            className="rounded-lg border border-black/15 px-3 py-2 font-bold disabled:opacity-50"
                            disabled={savingId === user.id}
                            onClick={() =>
                              updateUser(
                                user.id,
                                { isActive: true },
                                "Team member reactivated. They can log in again — the clients reassigned at deactivation stay with their new owners.",
                              )
                            }
                            type="button"
                          >
                            Reactivate
                          </button>
                        ) : (
                          <button
                            className="rounded-lg border border-red-700/40 bg-red-700/5 px-3 py-2 font-bold text-red-700 disabled:opacity-50"
                            disabled={savingId === user.id}
                            onClick={() => {
                              setMessage("");
                              setOffboarding(user);
                            }}
                            type="button"
                          >
                            Deactivate
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

/**
 * The offboarding form. Deactivation asks for more than a button press: a written
 * reason (PRD §4.2) and, when the member owns clients, somewhere for those clients to
 * go (F014 AC2). Presented before the request rather than after a refusal, so the
 * admin composes the whole decision once.
 */
function OffboardingForm({
  user,
  eligibleOwners,
  saving,
  onCancel,
  onConfirm,
}: {
  user: TeamUser;
  eligibleOwners: TeamUser[];
  saving: boolean;
  onCancel: () => void;
  onConfirm: (change: {
    reason: string;
    reassignTo?: string;
    releaseClients?: boolean;
  }) => void;
}) {
  const [reason, setReason] = useState("");
  const [destination, setDestination] = useState<"reassign" | "release">("reassign");
  // Deliberately unset. Defaulting to the first eligible owner means the acting admin
  // is usually preselected — they sort first as often as not — so a careless press
  // silently moves every client onto the person doing the offboarding. Verified
  // happening on 30 Jul 2026 before this was changed. Handing work to a named person
  // is a decision; it should require making one.
  const [reassignTo, setReassignTo] = useState("");

  const ownsClients = user.owned_client_count > 0;
  // With nobody eligible to take the clients on, releasing them to the unowned pool is
  // the only way to close the account. Saying so beats a select with no options.
  const noEligibleOwners = eligibleOwners.length === 0;
  const mustRelease = ownsClients && noEligibleOwners;
  const effectiveDestination = mustRelease ? "release" : destination;
  const canSubmit =
    reason.trim().length > 0 &&
    !saving &&
    (!ownsClients || effectiveDestination === "release" || reassignTo !== "");

  return (
    <form
      aria-label={`Deactivate ${displayName(user)}`}
      className="mt-3 rounded-xl border border-red-700/30 bg-red-50/60 p-5"
      onSubmit={(event) => {
        event.preventDefault();
        if (!canSubmit) return;
        onConfirm({
          reason: reason.trim(),
          ...(ownsClients
            ? effectiveDestination === "release"
              ? { releaseClients: true }
              : { reassignTo }
            : {}),
        });
      }}
    >
      <h2 className="text-lg font-bold">Deactivate {displayName(user)}</h2>
      <p className="mt-2 text-sm text-foreground/70">
        They will be signed out and blocked from logging in. Nothing is deleted — their
        history stays in the audit trail, and the account can be reactivated later.
      </p>

      {ownsClients && (
        <fieldset className="mt-4">
          <legend className="text-sm font-bold">
            {user.owned_client_count} client
            {user.owned_client_count === 1 ? "" : "s"} need a new owner
          </legend>
          {mustRelease ? (
            <p className="mt-2 text-sm text-foreground/70">
              No other active CAM or admin is available to take them on, so they will be
              released to the unowned pool for any CAM to claim.
            </p>
          ) : (
            <>
              <label className="mt-2 flex items-center gap-2 text-sm">
                <input
                  checked={effectiveDestination === "reassign"}
                  name="destination"
                  onChange={() => setDestination("reassign")}
                  type="radio"
                  value="reassign"
                />
                Reassign to
                <Select
                  disabled={effectiveDestination !== "reassign"}
                  onValueChange={setReassignTo}
                  value={reassignTo}
                >
                  <SelectTrigger aria-label="New owner" className="w-fit bg-white">
                    <SelectValue placeholder="Choose a team member…" />
                  </SelectTrigger>
                  <SelectContent>
                    {eligibleOwners.map((owner) => (
                      <SelectItem key={owner.id} value={owner.id}>
                        {displayName(owner)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              <label className="mt-2 flex items-center gap-2 text-sm">
                <input
                  checked={effectiveDestination === "release"}
                  name="destination"
                  onChange={() => setDestination("release")}
                  type="radio"
                  value="release"
                />
                Release to the unowned pool for any CAM to claim
              </label>
            </>
          )}
        </fieldset>
      )}

      <label className="mt-4 block text-sm font-bold" htmlFor="deactivation-reason">
        Reason
      </label>
      <textarea
        className="mt-1 w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm"
        id="deactivation-reason"
        maxLength={500}
        onChange={(event) => setReason(event.target.value)}
        required
        rows={2}
        value={reason}
      />
      <p className="mt-1 text-xs text-foreground/60">
        Recorded in the audit trail against this account and every client that moves.
      </p>

      <div className="mt-4 flex gap-2">
        <button
          className="rounded-lg bg-red-700 px-4 py-2 font-bold text-white disabled:opacity-50"
          disabled={!canSubmit}
          type="submit"
        >
          {saving ? "Deactivating…" : "Deactivate"}
        </button>
        <button
          className="rounded-lg border border-black/15 px-4 py-2 font-bold"
          disabled={saving}
          onClick={onCancel}
          type="button"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
