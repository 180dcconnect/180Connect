import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { assignOwnerRpcFailure, claimOwnershipRpcFailure } from "./ownership.ts";

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
