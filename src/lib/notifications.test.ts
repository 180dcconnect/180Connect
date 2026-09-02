import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  mapNotificationRows,
  notificationPriority,
  notificationRelativeTime,
  sortNotificationsByPriority,
  sortNotificationsNewestFirst,
  type RawNotificationRow,
} from "./notifications.ts";

function row(overrides: Partial<RawNotificationRow> = {}): RawNotificationRow {
  return {
    id: "n-1",
    notification_type: "team_activity",
    title: "Ownership assigned",
    body: "Oxford Homeless Project was assigned to you.",
    link_path: "/clients/org-1",
    read_at: null,
    created_at: "2026-08-21T12:00:00Z",
    ...overrides,
  };
}

describe("mapNotificationRows (F173)", () => {
  it("maps a well-formed row to the client shape", () => {
    const [item] = mapNotificationRows([row()]);
    assert.ok(item);
    assert.equal(item.id, "n-1");
    assert.equal(item.notificationType, "team_activity");
    assert.equal(item.title, "Ownership assigned");
    assert.equal(item.linkPath, "/clients/org-1");
    assert.equal(item.readAt, null);
  });

  it("drops malformed rows instead of throwing", () => {
    const items = mapNotificationRows([
      null,
      "not an object",
      row({ id: "" }),
      row({ title: undefined as unknown as string }),
      row({ created_at: undefined as unknown as string }),
      row({ id: "n-ok" }),
    ]);
    assert.deepEqual(
      items.map((i) => i.id),
      ["n-ok"],
    );
  });

  it("rejects link paths that are not absolute in-app routes", () => {
    const items = mapNotificationRows([
      row({ link_path: "https://evil.example.com" }),
      row({ id: "n-2", link_path: "javascript:alert(1)" }),
      row({ id: "n-3", link_path: null }),
    ]);
    assert.deepEqual(
      items.map((i) => i.linkPath),
      [null, null, null],
    );
  });

  it("returns an empty array for non-array input", () => {
    assert.deepEqual(mapNotificationRows(undefined), []);
    assert.deepEqual(mapNotificationRows({}), []);
  });
});

describe("sortNotificationsNewestFirst (F173)", () => {
  it("orders newest first without mutating the input", () => {
    const items = mapNotificationRows([
      row({ id: "older", created_at: "2026-08-20T09:00:00Z" }),
      row({ id: "newer", created_at: "2026-08-21T12:00:00Z" }),
    ]);
    const sorted = sortNotificationsNewestFirst(items);
    assert.deepEqual(sorted.map((i) => i.id), ["newer", "older"]);
    assert.deepEqual(items.map((i) => i.id), ["older", "newer"]);
  });
});

describe("notificationRelativeTime (F173)", () => {
  it("formats recent notifications relative to the passed now", () => {
    const item = mapNotificationRows([row()])[0];
    assert.ok(item);
    assert.equal(
      notificationRelativeTime(item, new Date("2026-08-21T12:05:00Z")),
      "5 minutes ago",
    );
  });
});

describe("notificationPriority (F174 AC3)", () => {
  it("treats reply_received as high priority", () => {
    assert.equal(notificationPriority("reply_received"), "high");
  });

  it("treats every other known type as normal priority", () => {
    assert.equal(notificationPriority("team_activity"), "normal");
    assert.equal(notificationPriority("outreach_send_failed"), "normal");
  });

  it("treats an unrecognised type as normal rather than throwing", () => {
    assert.equal(notificationPriority("some_future_type"), "normal");
  });
});

describe("sortNotificationsByPriority (F174 AC3)", () => {
  it("puts a high-priority notification ahead of an older normal one", () => {
    const items = mapNotificationRows([
      row({ id: "normal-newer", notification_type: "team_activity", created_at: "2026-08-21T12:00:00Z" }),
      row({ id: "reply-older", notification_type: "reply_received", created_at: "2026-08-20T09:00:00Z" }),
    ]);
    const sorted = sortNotificationsByPriority(items);
    assert.deepEqual(sorted.map((i) => i.id), ["reply-older", "normal-newer"]);
  });

  it("keeps newest-first ordering within the same priority tier", () => {
    const items = mapNotificationRows([
      row({ id: "reply-older", notification_type: "reply_received", created_at: "2026-08-20T09:00:00Z" }),
      row({ id: "reply-newer", notification_type: "reply_received", created_at: "2026-08-21T12:00:00Z" }),
    ]);
    const sorted = sortNotificationsByPriority(items);
    assert.deepEqual(sorted.map((i) => i.id), ["reply-newer", "reply-older"]);
  });

  it("matches plain newest-first when nothing is high priority", () => {
    const items = mapNotificationRows([
      row({ id: "older", created_at: "2026-08-20T09:00:00Z" }),
      row({ id: "newer", created_at: "2026-08-21T12:00:00Z" }),
    ]);
    assert.deepEqual(
      sortNotificationsByPriority(items).map((i) => i.id),
      sortNotificationsNewestFirst(items).map((i) => i.id),
    );
  });

  it("does not mutate the input", () => {
    const items = mapNotificationRows([
      row({ id: "a", created_at: "2026-08-20T09:00:00Z" }),
      row({ id: "b", notification_type: "reply_received", created_at: "2026-08-19T09:00:00Z" }),
    ]);
    const before = items.map((i) => i.id);
    sortNotificationsByPriority(items);
    assert.deepEqual(items.map((i) => i.id), before);
  });
});
