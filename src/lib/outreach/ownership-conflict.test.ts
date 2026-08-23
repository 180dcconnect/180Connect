import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  checkOwnershipConflict,
  ownershipClaimConflictMessage,
  ownershipConflictWarning,
} from "./ownership-conflict.ts";

describe("checkOwnershipConflict (F165)", () => {
  const actorCamId = "00000000-0000-4000-a000-000000000001";
  const otherCamId = "00000000-0000-4000-a000-000000000002";
  const adminId = "00000000-0000-4000-a000-000000000003";

  it("returns no conflict when client is unowned", () => {
    const result = checkOwnershipConflict({
      ownerId: null,
      actorId: actorCamId,
      actorRole: "cam",
    });
    assert.deepEqual(result, { hasConflict: false });
  });

  it("returns no conflict when CAM is the owner", () => {
    const result = checkOwnershipConflict({
      ownerId: actorCamId,
      ownerName: "Sarah CAM",
      actorId: actorCamId,
      actorRole: "cam",
    });
    assert.deepEqual(result, { hasConflict: false });
  });

  it("returns conflict warning when CAM views client owned by another CAM", () => {
    const result = checkOwnershipConflict({
      ownerId: otherCamId,
      ownerName: "Mohammed Saeed",
      actorId: actorCamId,
      actorRole: "cam",
    });

    assert.equal(result.hasConflict, true);
    if (result.hasConflict) {
      assert.equal(result.ownerId, otherCamId);
      assert.equal(result.ownerName, "Mohammed Saeed");
      assert.equal(
        result.warning,
        "This client is owned by Mohammed Saeed. Outreach is blocked to prevent duplicate contact — coordinate with them, or request this client from an admin (Ownership, below).",
      );
    }
  });

  it("falls back to generic wording when ownerName is omitted", () => {
    const result = checkOwnershipConflict({
      ownerId: otherCamId,
      actorId: actorCamId,
      actorRole: "cam",
    });

    assert.equal(result.hasConflict, true);
    if (result.hasConflict) {
      assert.equal(
        result.warning,
        "This client is owned by another team member. Outreach is blocked to prevent duplicate contact — coordinate with them, or request this client from an admin (Ownership, below).",
      );
    }
  });

  it("returns no conflict for a viewer, who has no outreach path", () => {
    const result = checkOwnershipConflict({
      ownerId: otherCamId,
      ownerName: "Mohammed Saeed",
      actorId: actorCamId,
      actorRole: "viewer",
    });

    assert.deepEqual(result, { hasConflict: false });
  });

  it("returns no conflict for admin user regardless of owner", () => {
    const result = checkOwnershipConflict({
      ownerId: otherCamId,
      ownerName: "Mohammed Saeed",
      actorId: adminId,
      actorRole: "admin",
    });

    assert.deepEqual(result, { hasConflict: false });
  });
});

describe("ownershipConflictWarning (F165)", () => {
  it("formats warning with owner name", () => {
    const warning = ownershipConflictWarning("Alex Chen");
    assert.equal(
      warning,
      "This client is owned by Alex Chen. Outreach is blocked to prevent duplicate contact — coordinate with them, or request this client from an admin (Ownership, below).",
    );
  });

  it("handles empty or null name", () => {
    const warning = ownershipConflictWarning(null);
    assert.equal(
      warning,
      "This client is owned by another team member. Outreach is blocked to prevent duplicate contact — coordinate with them, or request this client from an admin (Ownership, below).",
    );
  });
});

describe("ownershipClaimConflictMessage (F165 AC2)", () => {
  it("names the current owner", () => {
    assert.equal(
      ownershipClaimConflictMessage("Alex Chen"),
      "This client is already owned by Alex Chen. Self-assignment cannot override an existing owner — request it from an admin instead.",
    );
  });

  it("falls back when the owner name cannot be resolved", () => {
    assert.equal(
      ownershipClaimConflictMessage(null),
      "This client is already owned by another team member. Self-assignment cannot override an existing owner — request it from an admin instead.",
    );
  });
});
