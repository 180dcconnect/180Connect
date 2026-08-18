import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  assignOwnerRpcFailure,
  claimOwnershipRpcFailure,
  isNoOpReassignment,
  NO_OP_REASSIGNMENT_MESSAGE,
  validateReassignOwnership,
} from "./ownership.ts";

describe("claimOwnershipRpcFailure", () => {
  it("passes through the RPC's own message for a permission failure", () => {
    assert.deepEqual(
      claimOwnershipRpcFailure({
        code: "42501",
        message: "only a CAM or admin may take ownership of a client",
      }),
      { status: 403, error: "only a CAM or admin may take ownership of a client" },
    );
  });

  it("maps a not-found client to 404", () => {
    assert.deepEqual(
      claimOwnershipRpcFailure({
        code: "P0002",
        message: "that client could not be found",
      }),
      { status: 404, error: "that client could not be found" },
    );
  });

  it("maps an already-owned conflict to 409, distinct from every other failure", () => {
    const result = claimOwnershipRpcFailure({
      code: "55000",
      message: "this client is already owned by another CAM",
    });
    assert.equal(result.status, 409);
    assert.equal(result.error, "this client is already owned by another CAM");
  });

  it("never leaks internals for an unexpected error", () => {
    const result = claimOwnershipRpcFailure({
      code: "23503",
      message:
        'insert or update on table "organisations" violates foreign key constraint',
    });
    assert.equal(result.status, 500);
    assert.doesNotMatch(result.error, /organisations|constraint|table/i);
  });

  it("does not emit an empty message when the RPC sent none", () => {
    const result = claimOwnershipRpcFailure({ code: "42501", message: "   " });
    assert.equal(result.status, 500);
    assert.match(result.error, /\S/);
  });

  it("handles an error object with no code at all", () => {
    const result = claimOwnershipRpcFailure({});
    assert.equal(result.status, 500);
    assert.match(result.error, /\S/);
  });
});

describe("assignOwnerRpcFailure", () => {
  it("passes through the RPC's own message for a permission failure", () => {
    assert.deepEqual(
      assignOwnerRpcFailure({
        code: "42501",
        message: "only an admin may reassign client ownership",
      }),
      { status: 403, error: "only an admin may reassign client ownership" },
    );
  });

  it("maps a not-found destination user to 404", () => {
    assert.deepEqual(
      assignOwnerRpcFailure({
        code: "P0002",
        message: "the chosen user does not exist",
      }),
      { status: 404, error: "the chosen user does not exist" },
    );
  });

  it("maps a validation failure (blank reason, inactive destination) to 400", () => {
    assert.deepEqual(
      assignOwnerRpcFailure({
        code: "22023",
        message: "a reason is required so the handover can be understood later",
      }),
      { status: 400, error: "a reason is required so the handover can be understood later" },
    );
  });

  it("never leaks internals for an unexpected error", () => {
    const result = assignOwnerRpcFailure({
      code: "23503",
      message:
        'insert or update on table "organisations" violates foreign key constraint',
    });
    assert.equal(result.status, 500);
    assert.doesNotMatch(result.error, /organisations|constraint|table/i);
  });

  it("does not emit an empty message when the RPC sent none", () => {
    const result = assignOwnerRpcFailure({ code: "42501", message: "   " });
    assert.equal(result.status, 500);
    assert.match(result.error, /\S/);
  });

  it("handles an error object with no code at all", () => {
    const result = assignOwnerRpcFailure({});
    assert.equal(result.status, 500);
    assert.match(result.error, /\S/);
  });
});

describe("validateReassignOwnership (F163/F164)", () => {
  const validOrgId = "11111111-1111-4111-8111-111111111111";
  const validOwnerId = "22222222-2222-4222-8222-222222222222";
  const differentOwnerId = "33333333-3333-4333-8333-333333333333";

  it("validates successful reassignment input", () => {
    const result = validateReassignOwnership({
      organisationId: validOrgId,
      newOwnerId: validOwnerId,
      reason: "Handing over to new CAM",
      currentOwnerId: differentOwnerId,
    });

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.data.organisationId, validOrgId);
      assert.equal(result.data.newOwnerId, validOwnerId);
      assert.equal(result.data.reason, "Handing over to new CAM");
    }
  });

  it("trims whitespace from reason", () => {
    const result = validateReassignOwnership({
      organisationId: validOrgId,
      newOwnerId: validOwnerId,
      reason: "   Workload rebalance   ",
    });

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.data.reason, "Workload rebalance");
    }
  });

  it("rejects invalid organisation ID", () => {
    const result = validateReassignOwnership({
      organisationId: "not-a-uuid",
      newOwnerId: validOwnerId,
      reason: "Handover",
    });

    assert.deepEqual(result, {
      ok: false,
      error: "That client could not be found.",
    });
  });

  it("rejects invalid new owner ID", () => {
    const result = validateReassignOwnership({
      organisationId: validOrgId,
      newOwnerId: "invalid-user",
      reason: "Handover",
    });

    assert.deepEqual(result, {
      ok: false,
      error: "Choose a CAM to assign.",
    });
  });

  it("rejects missing or empty reason", () => {
    const result = validateReassignOwnership({
      organisationId: validOrgId,
      newOwnerId: validOwnerId,
      reason: "    ",
    });

    assert.deepEqual(result, {
      ok: false,
      error: "A reason is required so the handover can be understood later.",
    });
  });

  it("rejects selecting the exact same current owner", () => {
    const result = validateReassignOwnership({
      organisationId: validOrgId,
      newOwnerId: validOwnerId,
      reason: "Handover",
      currentOwnerId: validOwnerId,
    });

    assert.deepEqual(result, {
      ok: false,
      error: NO_OP_REASSIGNMENT_MESSAGE,
    });
  });

  it("allows the same owner id when no current owner is supplied", () => {
    const result = validateReassignOwnership({
      organisationId: validOrgId,
      newOwnerId: validOwnerId,
      reason: "Handover",
    });

    assert.equal(result.ok, true);
  });
});

describe("isNoOpReassignment (F164)", () => {
  const ownerId = "22222222-2222-4222-8222-222222222222";

  it("is true when the chosen CAM already owns the client", () => {
    assert.equal(isNoOpReassignment(ownerId, ownerId), true);
  });

  it("ignores case and surrounding whitespace", () => {
    assert.equal(isNoOpReassignment(` ${ownerId.toUpperCase()} `, ownerId), true);
  });

  it("is false for a different CAM", () => {
    assert.equal(
      isNoOpReassignment(ownerId, "33333333-3333-4333-8333-333333333333"),
      false,
    );
  });

  it("is false for an unowned client, so a first assignment goes through", () => {
    assert.equal(isNoOpReassignment(null, ownerId), false);
    assert.equal(isNoOpReassignment(undefined, ownerId), false);
  });
});
