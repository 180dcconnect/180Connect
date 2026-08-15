import { INVITE_EXPIRY_HOURS } from "../auth/invite.ts";

export type TeamUser = {
  id: string;
  email: string;
  full_name: string | null;
  role: "cam" | "admin" | "viewer";
  is_active: boolean;
  deactivated_at: string | null;
  owned_client_count: number;
};

export type PendingInvite = {
  id: string;
  email: string;
  invited_at: string;
  role: TeamUser["role"];
};

export type TeamPanelState = {
  teamUsers: TeamUser[];
  pendingInvites: PendingInvite[];
};

/**
 * The shape of a `public.users` row as `postgres_changes` broadcasts it: every
 * column, but none of the joined/derived fields (`owned_client_count`) the page's
 * own queries add, and none of the guarantees a plain `select` gives — a
 * mid-migration or redacted payload can still be missing fields.
 */
type RealtimeUserRow = {
  id?: string;
  email?: string;
  full_name?: string | null;
  role?: TeamUser["role"];
  is_active?: boolean;
  deactivated_at?: string | null;
  invited_at?: string | null;
  invite_accepted_at?: string | null;
};

type RealtimeUserPayload = {
  eventType: "INSERT" | "UPDATE" | "DELETE";
  new: RealtimeUserRow;
  old: RealtimeUserRow;
};

/** Mirrors the page's own split (F008 AC5): a row is a pending invite until accepted. */
function isPendingInvite(row: RealtimeUserRow): boolean {
  return Boolean(row.invited_at) && !row.invite_accepted_at;
}

function sortByName(users: TeamUser[]): TeamUser[] {
  return [...users].sort((a, b) =>
    (a.full_name ?? a.email).localeCompare(b.full_name ?? b.email),
  );
}

function sortByInvitedAtDesc(invites: PendingInvite[]): PendingInvite[] {
  return [...invites].sort((a, b) => b.invited_at.localeCompare(a.invited_at));
}

/**
 * Whether an invite link has likely expired, purely as a display hint —
 * Supabase Auth (Authentication → Providers → Email → invite expiry) is the
 * actual authority, this only mirrors the same `INVITE_EXPIRY_HOURS` the
 * invite email already quotes (`src/lib/auth/invite.ts`). Resend stays
 * available regardless: minting a fresh link is exactly the fix.
 */
export function isInviteExpired(invitedAt: string, now: Date = new Date()): boolean {
  const invitedAtMs = new Date(invitedAt).getTime();
  const expiryMs = invitedAtMs + INVITE_EXPIRY_HOURS * 60 * 60 * 1000;
  return now.getTime() >= expiryMs;
}

/**
 * Folds one realtime change into the current split state. Pure and
 * framework-free so the row-classification and merge logic can be unit-tested
 * without mocking Supabase or React — the client component (team-panel.tsx)
 * only wires this to a subscription.
 */
export function applyRealtimeUserChange(
  state: TeamPanelState,
  payload: RealtimeUserPayload,
): TeamPanelState {
  if (payload.eventType === "DELETE") {
    const removedId = payload.old.id;
    if (!removedId) return state;
    return {
      teamUsers: state.teamUsers.filter((user) => user.id !== removedId),
      pendingInvites: state.pendingInvites.filter(
        (invite) => invite.id !== removedId,
      ),
    };
  }

  const row = payload.new;
  // A redacted or otherwise incomplete payload (no id) is never actionable —
  // drop it rather than render a row for a user that doesn't really exist.
  if (!row.id) return state;

  if (isPendingInvite(row)) {
    const existingInvite = state.pendingInvites.find((invite) => invite.id === row.id);
    const invite: PendingInvite = {
      id: row.id,
      email: row.email ?? "",
      invited_at: row.invited_at as string,
      role: row.role ?? existingInvite?.role ?? "cam",
    };
    return {
      teamUsers: state.teamUsers.filter((user) => user.id !== row.id),
      pendingInvites: sortByInvitedAtDesc([
        ...state.pendingInvites.filter((existing) => existing.id !== row.id),
        invite,
      ]),
    };
  }

  // owned_client_count is joined from `organisations`, not a `users` column, so
  // no realtime payload ever carries it — the existing value (or 0, for a row
  // just promoted out of "pending", which cannot own clients yet) is kept.
  const existing = state.teamUsers.find((user) => user.id === row.id);
  const teamUser: TeamUser = {
    id: row.id,
    email: row.email ?? existing?.email ?? "",
    full_name: row.full_name ?? existing?.full_name ?? null,
    role: row.role ?? existing?.role ?? "cam",
    is_active: row.is_active ?? existing?.is_active ?? true,
    deactivated_at: row.deactivated_at ?? existing?.deactivated_at ?? null,
    owned_client_count: existing?.owned_client_count ?? 0,
  };

  return {
    teamUsers: sortByName([
      ...state.teamUsers.filter((user) => user.id !== row.id),
      teamUser,
    ]),
    pendingInvites: state.pendingInvites.filter(
      (invite) => invite.id !== row.id,
    ),
  };
}
