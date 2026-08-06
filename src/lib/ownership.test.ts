import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { claimOwnershipRpcFailure } from "./ownership.ts";

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
