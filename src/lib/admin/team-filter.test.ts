import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { TeamUser } from "./team-realtime.ts";
import {
  filterTeamUsers,
  parseArrayParam,
  sortTeamUsers,
} from "./team-filter.ts";

function createTestUser(overrides: Partial<TeamUser> = {}): TeamUser {
  return {
    id: "user-1",
    email: "sarah@180dc.org",
    full_name: "Sarah Hughes",
    role: "cam",
    is_active: true,
    deactivated_at: null,
    last_seen_at: "2026-08-31T12:00:00.000Z",
    owned_client_count: 3,
    listed_client_count: 3,
    ...overrides,
  };
}

const NOW = new Date("2026-09-01T12:00:00.000Z"); // 24h after Sarah's last_seen_at

const SAMPLE_USERS: TeamUser[] = [
  createTestUser({
    id: "u1",
    full_name: "Alice Smith",
    email: "alice@180dc.org",
    role: "admin",
    listed_client_count: 0,
    owned_client_count: 0,
    last_seen_at: "2026-09-01T10:00:00.000Z", // 2 hours ago (today)
    is_active: true,
  }),
  createTestUser({
    id: "u2",
    full_name: "Bob Jones",
    email: "bob@180dc.org",
    role: "cam",
    listed_client_count: 4,
    owned_client_count: 4,
    last_seen_at: "2026-08-28T12:00:00.000Z", // 4 days ago (this week)
    is_active: true,
  }),
  createTestUser({
    id: "u3",
    full_name: "Charlie Brown",
    email: "charlie@180dc.org",
    role: "viewer",
    listed_client_count: 8,
    owned_client_count: 8,
    last_seen_at: "2026-08-15T12:00:00.000Z", // 17 days ago (this month)
    is_active: true,
  }),
  createTestUser({
    id: "u4",
    full_name: "Diana Prince",
    email: "diana@180dc.org",
    role: "cam",
    listed_client_count: 15,
    owned_client_count: 15,
    last_seen_at: "2026-07-01T12:00:00.000Z", // 62 days ago (> 30 days inactive)
    is_active: true,
  }),
  createTestUser({
    id: "u5",
    full_name: "Edward Stone",
    email: "edward@180dc.org",
    role: "cam",
    listed_client_count: 0,
    owned_client_count: 0,
    last_seen_at: "2026-05-01T12:00:00.000Z", // 123 days ago (> 90 days inactive)
    is_active: false,
    deactivated_at: "2026-05-01T12:00:00.000Z",
  }),
  createTestUser({
    id: "u6",
    full_name: null,
    email: "ghost@180dc.org",
    role: "viewer",
    listed_client_count: 0,
    owned_client_count: 0,
    last_seen_at: null, // Never active
    is_active: true,
  }),
];

describe("filterTeamUsers — text search", () => {
  it("returns all users when query is empty or whitespace", () => {
    const result = filterTeamUsers(SAMPLE_USERS, { query: "   " }, NOW);
    assert.equal(result.length, SAMPLE_USERS.length);
  });

  it("matches full name case-insensitively", () => {
    const result = filterTeamUsers(SAMPLE_USERS, { query: "alice" }, NOW);
    assert.equal(result.length, 1);
    assert.equal(result[0]?.id, "u1");
  });

  it("matches email substring", () => {
    const result = filterTeamUsers(SAMPLE_USERS, { query: "ghost@" }, NOW);
    assert.equal(result.length, 1);
    assert.equal(result[0]?.id, "u6");
  });

  it("matches partial name", () => {
    const result = filterTeamUsers(SAMPLE_USERS, { query: "char" }, NOW);
    assert.equal(result.length, 1);
    assert.equal(result[0]?.id, "u3");
  });
});

describe("filterTeamUsers — role filter", () => {
  it("filters by single role", () => {
    const result = filterTeamUsers(SAMPLE_USERS, { roles: ["admin"] }, NOW);
    assert.equal(result.length, 1);
    assert.equal(result[0]?.id, "u1");
  });

  it("filters by multiple roles (OR)", () => {
    const result = filterTeamUsers(SAMPLE_USERS, { roles: ["admin", "viewer"] }, NOW);
    assert.equal(result.length, 3); // u1 (admin), u3 (viewer), u6 (viewer)
    const ids = result.map((u) => u.id).sort();
    assert.deepEqual(ids, ["u1", "u3", "u6"]);
  });
});

describe("filterTeamUsers — client load filter", () => {
  it("filters by '0' (no clients)", () => {
    const result = filterTeamUsers(SAMPLE_USERS, { clientRanges: ["0"] }, NOW);
    assert.equal(result.length, 3); // u1, u5, u6
    assert.deepEqual(result.map((u) => u.id).sort(), ["u1", "u5", "u6"]);
  });

  it("filters by 'has_clients' (1+ clients)", () => {
    const result = filterTeamUsers(SAMPLE_USERS, { clientRanges: ["has_clients"] }, NOW);
    assert.equal(result.length, 3); // u2 (4), u3 (8), u4 (15)
    assert.deepEqual(result.map((u) => u.id).sort(), ["u2", "u3", "u4"]);
  });

  it("filters by '1-5' clients", () => {
    const result = filterTeamUsers(SAMPLE_USERS, { clientRanges: ["1-5"] }, NOW);
    assert.equal(result.length, 1); // u2 (4)
    assert.equal(result[0]?.id, "u2");
  });

  it("filters by '6-10' clients", () => {
    const result = filterTeamUsers(SAMPLE_USERS, { clientRanges: ["6-10"] }, NOW);
    assert.equal(result.length, 1); // u3 (8)
    assert.equal(result[0]?.id, "u3");
  });

  it("filters by '10+' clients", () => {
    const result = filterTeamUsers(SAMPLE_USERS, { clientRanges: ["10+"] }, NOW);
    assert.equal(result.length, 1); // u4 (15)
    assert.equal(result[0]?.id, "u4");
  });

  it("combines multiple client ranges (OR)", () => {
    const result = filterTeamUsers(SAMPLE_USERS, { clientRanges: ["1-5", "10+"] }, NOW);
    assert.equal(result.length, 2); // u2 (4), u4 (15)
    assert.deepEqual(result.map((u) => u.id).sort(), ["u2", "u4"]);
  });
});

describe("filterTeamUsers — last active filter", () => {
  it("filters by 'today' (within 24h)", () => {
    const result = filterTeamUsers(SAMPLE_USERS, { lastActiveRanges: ["today"] }, NOW);
    assert.equal(result.length, 1); // u1 (2h ago)
    assert.equal(result[0]?.id, "u1");
  });

  it("filters by 'week' (within 7 days)", () => {
    const result = filterTeamUsers(SAMPLE_USERS, { lastActiveRanges: ["week"] }, NOW);
    assert.equal(result.length, 2); // u1 (2h), u2 (4d)
    assert.deepEqual(result.map((u) => u.id).sort(), ["u1", "u2"]);
  });

  it("filters by 'month' (within 30 days)", () => {
    const result = filterTeamUsers(SAMPLE_USERS, { lastActiveRanges: ["month"] }, NOW);
    assert.equal(result.length, 3); // u1, u2, u3 (17d)
    assert.deepEqual(result.map((u) => u.id).sort(), ["u1", "u2", "u3"]);
  });

  it("filters by 'inactive_30d' (> 30 days)", () => {
    const result = filterTeamUsers(SAMPLE_USERS, { lastActiveRanges: ["inactive_30d"] }, NOW);
    assert.equal(result.length, 2); // u4 (62d), u5 (123d)
    assert.deepEqual(result.map((u) => u.id).sort(), ["u4", "u5"]);
  });

  it("filters by 'inactive_90d' (> 90 days)", () => {
    const result = filterTeamUsers(SAMPLE_USERS, { lastActiveRanges: ["inactive_90d"] }, NOW);
    assert.equal(result.length, 1); // u5 (123d)
    assert.equal(result[0]?.id, "u5");
  });

  it("filters by 'never' (null last_seen_at)", () => {
    const result = filterTeamUsers(SAMPLE_USERS, { lastActiveRanges: ["never"] }, NOW);
    assert.equal(result.length, 1); // u6
    assert.equal(result[0]?.id, "u6");
  });
});

describe("filterTeamUsers — status filter", () => {
  it("filters by active accounts", () => {
    const result = filterTeamUsers(SAMPLE_USERS, { statuses: ["active"] }, NOW);
    assert.equal(result.length, 5);
    assert.ok(result.every((u) => u.is_active));
  });

  it("filters by deactivated accounts", () => {
    const result = filterTeamUsers(SAMPLE_USERS, { statuses: ["deactivated"] }, NOW);
    assert.equal(result.length, 1);
    assert.equal(result[0]?.id, "u5");
  });
});

describe("filterTeamUsers — combined criteria", () => {
  it("combines query, role, and client count", () => {
    const result = filterTeamUsers(
      SAMPLE_USERS,
      {
        query: "jones",
        roles: ["cam"],
        clientRanges: ["1-5"],
      },
      NOW,
    );
    assert.equal(result.length, 1);
    assert.equal(result[0]?.id, "u2");
  });

  it("returns empty when criteria do not overlap", () => {
    const result = filterTeamUsers(
      SAMPLE_USERS,
      {
        roles: ["admin"],
        clientRanges: ["10+"],
      },
      NOW,
    );
    assert.equal(result.length, 0);
  });
});

describe("sortTeamUsers", () => {
  it("sorts by name ascending", () => {
    const sorted = sortTeamUsers(SAMPLE_USERS, "name", "asc");
    assert.equal(sorted[0]?.full_name, "Alice Smith");
  });

  it("sorts by name descending", () => {
    const sorted = sortTeamUsers(SAMPLE_USERS, "name", "desc");
    const lastOrGhost = sorted[0];
    assert.ok(
      lastOrGhost?.email === "ghost@180dc.org" ||
        lastOrGhost?.full_name === "Edward Stone",
    );
  });

  it("sorts by clients count descending", () => {
    const sorted = sortTeamUsers(SAMPLE_USERS, "clients", "desc");
    assert.equal(sorted[0]?.id, "u4"); // 15 clients
    assert.equal(sorted[1]?.id, "u3"); // 8 clients
    assert.equal(sorted[2]?.id, "u2"); // 4 clients
  });

  it("sorts by clients count ascending", () => {
    const sorted = sortTeamUsers(SAMPLE_USERS, "clients", "asc");
    assert.equal(sorted[0]?.listed_client_count, 0);
    assert.equal(sorted[sorted.length - 1]?.id, "u4"); // 15 clients
  });

  it("sorts by role (admin first, then cam, then viewer)", () => {
    const sorted = sortTeamUsers(SAMPLE_USERS, "role", "asc");
    assert.equal(sorted[0]?.role, "admin");
  });
});

describe("parseArrayParam", () => {
  it("handles string", () => {
    assert.deepEqual(parseArrayParam("cam"), ["cam"]);
  });

  it("handles array", () => {
    assert.deepEqual(parseArrayParam(["cam", "admin"]), ["cam", "admin"]);
  });

  it("handles undefined", () => {
    assert.deepEqual(parseArrayParam(undefined), []);
  });
});
