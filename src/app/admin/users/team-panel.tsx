"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/browser";
import {
  applyRealtimeUserChange,
  type PendingInvite,
  type TeamPanelState,
  type TeamUser,
} from "@/lib/admin/team-realtime";
import { PendingInvitesList } from "./pending-invites-list";
import { UserManagementTable } from "./user-management-table";
import { Group, Rise } from "@/components/dashboard-stage";
import { InlineAlert } from "@/components/ui/inline-alert";

export function TeamPanel({
  currentUserId,
  initialTeamUsers,
  initialPendingInvites,
  pendingInvitesError,
}: {
  currentUserId: string;
  initialTeamUsers: TeamUser[];
  initialPendingInvites: PendingInvite[];
  pendingInvitesError: boolean;
}) {
  // Both lists are one state object, not two, so a realtime change can move a
  // row between them (invite accepted -> team member) in a single update. A
  // functional setState update is used below rather than closing over these
  // values, since the subscription's effect only runs once per mount.
  const [state, setState] = useState<TeamPanelState>({
    teamUsers: initialTeamUsers,
    pendingInvites: initialPendingInvites,
  });
  const [connectionLost, setConnectionLost] = useState(false);

  // Keeps both lists live: a role change or suspension from another admin (F012,
  // F013), a deactivation (F014), or a new invite being sent or accepted (F008)
  // all land here without a page reload — F011 AC4. Requires `users` in the
  // supabase_realtime publication (20260805120000_enable_realtime_users.sql); RLS
  // still governs which rows a subscriber actually receives.
  useEffect(() => {
    const supabase = createClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;

    async function subscribe() {
      // The browser client reads the login session from cookies for normal
      // requests, but the realtime WebSocket doesn't inherit that — without
      // handing it the access token explicitly, it connects as `anon`, which has
      // no grant on `users`. Realtime then still emits the change event but
      // redacts new/old to `{}` rather than skipping it, producing a blank
      // "ghost" row instead of an update.
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (cancelled) return;
      supabase.realtime.setAuth(session?.access_token);

      channel = supabase
        .channel("admin-users-list")
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "users" },
          (payload) => {
            setState((current) =>
              applyRealtimeUserChange(current, {
                eventType: payload.eventType,
                new: payload.new as Record<string, unknown>,
                old: payload.old as Record<string, unknown>,
              }),
            );
          },
        )
        .subscribe((status) => {
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
            setConnectionLost(true);
          } else if (status === "SUBSCRIBED") {
            setConnectionLost(false);
          }
        });
    }

    subscribe();

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, []);

  /**
   * UserManagementTable owns its own PATCH-driven updates via `setUsers`
   * (unchanged since before F011) and expects the plain `TeamUser[]`
   * `Dispatch<SetStateAction<...>>` shape; this folds either form of update
   * into the combined `{teamUsers, pendingInvites}` state above.
   */
  function setTeamUsers(action: TeamUser[] | ((current: TeamUser[]) => TeamUser[])) {
    setState((current) => ({
      ...current,
      teamUsers:
        typeof action === "function" ? action(current.teamUsers) : action,
    }));
  }

  return (
    <>
      {connectionLost && (
        <div className="mb-6">
          <InlineAlert message="Live updates paused — refresh the page to see the latest changes." />
        </div>
      )}
      <Group className="space-y-4">
        <Rise>
          <div className="rounded-2xl border border-black/[0.06] bg-white p-5 shadow-sm overflow-hidden">
            <UserManagementTable
              currentUserId={currentUserId}
              setUsers={setTeamUsers}
              users={state.teamUsers}
            />
          </div>
        </Rise>
      </Group>

      <Group className="mt-10 space-y-4">
        <Rise className="flex items-baseline justify-between gap-4">
          <h2 className="text-xl font-semibold font-body tracking-[-0.02em]">Pending invites</h2>
        </Rise>
        <Rise>
          <div className="rounded-2xl border border-black/[0.06] bg-white p-5 shadow-sm">
            <PendingInvitesList error={pendingInvitesError} invites={state.pendingInvites} />
          </div>
        </Rise>
      </Group>
    </>
  );
}
