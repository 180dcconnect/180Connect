import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { NOTIFICATION_CATALOGUE, notificationsForAbilities } from "./notification-catalogue.ts";

describe("notification catalogue", () => {
  it("has one entry per type", () => {
    const types = NOTIFICATION_CATALOGUE.map((kind) => kind.type);
    assert.equal(new Set(types).size, types.length);
  });

  it("shows a viewer only what everyone receives", () => {
    const kinds = notificationsForAbilities({ canEditClients: false, isAdmin: false });
    assert.ok(kinds.every((kind) => kind.audience === "everyone"));
    assert.ok(kinds.length > 0);
  });

  it("shows a CAM client notifications but not the admin fallback", () => {
    const types = notificationsForAbilities({ canEditClients: true, isAdmin: false }).map(
      (kind) => kind.type,
    );
    assert.ok(types.includes("client_reply_received"));
    assert.ok(!types.includes("unowned_client_reply_received"));
  });

  it("shows an admin everything", () => {
    assert.equal(
      notificationsForAbilities({ canEditClients: true, isAdmin: true }).length,
      NOTIFICATION_CATALOGUE.length,
    );
  });
});
