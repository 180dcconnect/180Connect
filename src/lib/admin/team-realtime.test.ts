import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  applyRealtimeUserChange,
  isInviteExpired,
  type PendingInvite,
  type TeamPanelState,
  type TeamUser,
} from "./team-realtime.ts";
import { INVITE_EXPIRY_HOURS } from "../auth/invite.ts";

function teamUser(overrides: Partial<TeamUser> = {}): TeamUser {
  return {
    id: "u1",
    email: "a@180dc.org",
    full_name: "Alice",
    role: "cam",
    is_active: true,
    deactivated_at: null,
    last_seen_at: null,
    owned_client_count: 2,
    ...overrides,
  };
}

function pendingInvite(overrides: Partial<PendingInvite> = {}): PendingInvite {
  return {
    id: "u2",
    email: "b@180dc.org",
    invited_at: "2026-08-01T00:00:00.000Z",
    role: "cam",
    ...overrides,
  };
}

const emptyState: TeamPanelState = { teamUsers: [], pendingInvites: [] };

describe("applyRealtimeUserChange", () => {
  it("adds a new pending invite (INSERT, invited_at set, not yet accepted)", () => {
    const next = applyRealtimeUserChange(emptyState, {
      eventType: "INSERT",
      old: {},
      new: {
        id: "u3",
        email: "new@180dc.org",
        invited_at: "2026-08-05T10:00:00.000Z",
        invite_accepted_at: null,
      },
    });

    assert.deepEqual(next.pendingInvites, [
      { id: "u3", email: "new@180dc.org", invited_at: "2026-08-05T10:00:00.000Z", role: "cam" },
    ]);
    assert.deepEqual(next.teamUsers, []);
  });

  it("moves a row from pending to the team list once the invite is accepted", () => {
    const state: TeamPanelState = {
      teamUsers: [],
      pendingInvites: [pendingInvite()],
    };

    const next = applyRealtimeUserChange(state, {
      eventType: "UPDATE",
      old: {},
      new: {
        id: "u2",
        email: "b@180dc.org",
        full_name: "Bea",
        role: "cam",
        is_active: true,
        deactivated_at: null,
        invited_at: "2026-08-01T00:00:00.000Z",
        invite_accepted_at: "2026-08-05T09:00:00.000Z",
      },
    });

    assert.deepEqual(next.pendingInvites, []);
    assert.deepEqual(next.teamUsers, [
      teamUser({
        id: "u2",
        email: "b@180dc.org",
        full_name: "Bea",
        owned_client_count: 0,
      }),
    ]);
  });

  it("applies a role/suspension change to an existing team member, preserving owned_client_count", () => {
    const state: TeamPanelState = {
      teamUsers: [teamUser()],
      pendingInvites: [],
    };

    const next = applyRealtimeUserChange(state, {
      eventType: "UPDATE",
      old: {},
      new: {
        id: "u1",
        email: "a@180dc.org",
        full_name: "Alice",
        role: "admin",
        is_active: false,
        deactivated_at: null,
      },
    });

    assert.deepEqual(next.teamUsers, [
      teamUser({ role: "admin", is_active: false, owned_client_count: 2 }),
    ]);
  });

  it("removes a row on DELETE from whichever list it was in", () => {
    const state: TeamPanelState = {
      teamUsers: [teamUser()],
      pendingInvites: [pendingInvite()],
    };

    const next = applyRealtimeUserChange(state, {
      eventType: "DELETE",
      old: { id: "u1" },
      new: {},
    });

    assert.deepEqual(next.teamUsers, []);
    assert.deepEqual(next.pendingInvites, [pendingInvite()]);
  });

  it("drops a redacted payload with no id instead of throwing", () => {
    const next = applyRealtimeUserChange(emptyState, {
      eventType: "UPDATE",
      old: {},
      new: {},
    });

    assert.deepEqual(next, emptyState);
  });

  it("ignores a DELETE with no old.id", () => {
    const state: TeamPanelState = { teamUsers: [teamUser()], pendingInvites: [] };
    const next = applyRealtimeUserChange(state, {
      eventType: "DELETE",
      old: {},
      new: {},
    });
    assert.deepEqual(next, state);
  });

  it("carries the invited role through to the pending-invites list", () => {
    const next = applyRealtimeUserChange(emptyState, {
      eventType: "INSERT",
      old: {},
      new: {
        id: "u4",
        email: "admin-invite@180dc.org",
        role: "admin",
        invited_at: "2026-08-05T10:00:00.000Z",
        invite_accepted_at: null,
      },
    });

    assert.deepEqual(next.pendingInvites, [
      pendingInvite({
        id: "u4",
        email: "admin-invite@180dc.org",
        role: "admin",
        invited_at: "2026-08-05T10:00:00.000Z",
      }),
    ]);
  });
});

describe("isInviteExpired", () => {
  const invitedAt = "2026-08-01T00:00:00.000Z";

  it("is not expired before INVITE_EXPIRY_HOURS has passed", () => {
    const justBefore = new Date(
      new Date(invitedAt).getTime() + INVITE_EXPIRY_HOURS * 60 * 60 * 1000 - 1,
    );
    assert.equal(isInviteExpired(invitedAt, justBefore), false);
  });

  it("is expired once INVITE_EXPIRY_HOURS has passed", () => {
    const atBoundary = new Date(
      new Date(invitedAt).getTime() + INVITE_EXPIRY_HOURS * 60 * 60 * 1000,
    );
    assert.equal(isInviteExpired(invitedAt, atBoundary), true);
  });
});
