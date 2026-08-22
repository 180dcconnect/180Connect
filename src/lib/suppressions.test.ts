import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { suppressionRpcFailure } from "./suppressions.ts";

describe("suppressionRpcFailure (F251 / F185)", () => {
  it("maps 42501 to 403 Forbidden with exact message", () => {
    const res = suppressionRpcFailure({
      code: "42501",
      message: "only an admin may lift a suppression",
    });
    assert.deepEqual(res, { status: 403, error: "only an admin may lift a suppression" });
  });

  it("maps 23514 to 400 Bad Request with exact message", () => {
    const res = suppressionRpcFailure({
      code: "23514",
      message: "a reason is required to lift a suppression",
    });
    assert.deepEqual(res, { status: 400, error: "a reason is required to lift a suppression" });
  });

  it("maps 55000 to 409 Conflict with exact message", () => {
    const res = suppressionRpcFailure({
      code: "55000",
      message: "suppression 11111111-1111-1111-1111-111111111111 is not active",
    });
    assert.deepEqual(res, {
      status: 409,
      error: "suppression 11111111-1111-1111-1111-111111111111 is not active",
    });
  });

  it("maps P0002 to 404 Not Found with exact message", () => {
    const res = suppressionRpcFailure({
      code: "P0002",
      message: "suppression 11111111-1111-1111-1111-111111111111 not found",
    });
    assert.deepEqual(res, {
      status: 404,
      error: "suppression 11111111-1111-1111-1111-111111111111 not found",
    });
  });

  it("falls back to generic error message for unknown or unhandled errors", () => {
    const res = suppressionRpcFailure({
      code: "XX000",
      message: "internal postgres deadlock",
    });
    assert.deepEqual(res, {
      status: 500,
      error: "The suppression request could not be saved. Refresh and try again.",
    });
  });

  it("handles empty or blank error messages safely", () => {
    const res = suppressionRpcFailure({
      code: "42501",
      message: "   ",
    });
    assert.deepEqual(res, {
      status: 500,
      error: "The suppression request could not be saved. Refresh and try again.",
    });
  });
});
