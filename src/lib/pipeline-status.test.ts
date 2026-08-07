import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { setOutreachStatusRpcFailure } from "./pipeline-status.ts";

describe("setOutreachStatusRpcFailure", () => {
  it("passes through the RPC's own message for a permission failure", () => {
    assert.deepEqual(
      setOutreachStatusRpcFailure({
        code: "42501",
        message: "only the client's owner or an admin may change its status",
      }),
      { status: 403, error: "only the client's owner or an admin may change its status" },
    );
  });

  it("maps a not-found client to 404", () => {
    assert.deepEqual(
      setOutreachStatusRpcFailure({
        code: "P0002",
        message: "that client could not be found",
      }),
      { status: 404, error: "that client could not be found" },
    );
  });

  it("never leaks internals for an unexpected error", () => {
    const result = setOutreachStatusRpcFailure({
      code: "22P02",
      message: 'invalid input value for enum outreach_status: "bogus"',
    });
    assert.equal(result.status, 500);
    assert.doesNotMatch(result.error, /enum|outreach_status/i);
  });

  it("does not emit an empty message when the RPC sent none", () => {
    const result = setOutreachStatusRpcFailure({ code: "42501", message: "   " });
    assert.equal(result.status, 500);
    assert.match(result.error, /\S/);
  });

  it("handles an error object with no code at all", () => {
    const result = setOutreachStatusRpcFailure({});
    assert.equal(result.status, 500);
    assert.match(result.error, /\S/);
  });
});
