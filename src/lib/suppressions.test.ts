import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { suppressionRpcFailure } from "./suppressions.ts";

describe("suppressionRpcFailure (F251 / F185)", () => {
  it("translates a permission refusal without exposing the database message", () => {
    const res = suppressionRpcFailure({
      code: "42501",
      message: "only an admin may lift a suppression",
    });
    assert.deepEqual(res, {
      status: 403,
      error: "Only an admin can make this suppression change.",
    });
  });

  it("translates a missing reason into the next action", () => {
    const res = suppressionRpcFailure({
      code: "23514",
      message: "a reason is required to lift a suppression",
    });
    assert.deepEqual(res, {
      status: 400,
      error: "Enter a reason before saving this suppression change.",
    });
  });

  it("does not leak the suppression id when its status has changed", () => {
    const res = suppressionRpcFailure({
      code: "55000",
      message: "suppression 11111111-1111-1111-1111-111111111111 is not active",
    });
    assert.deepEqual(res, {
      status: 409,
      error: "This suppression has already changed. Refresh the page to see its current status.",
    });
  });

  it("does not leak the suppression id when it no longer exists", () => {
    const res = suppressionRpcFailure({
      code: "P0002",
      message: "suppression 11111111-1111-1111-1111-111111111111 not found",
    });
    assert.deepEqual(res, {
      status: 404,
      error: "This suppression or client could not be found. Refresh the page and try again.",
    });
  });

  it("explains that a second open suppression is not allowed", () => {
    const res = suppressionRpcFailure({
      code: "23505",
      message: "organisation 11111111-1111-1111-1111-111111111111 already has an open suppression request",
    });
    assert.deepEqual(res, {
      status: 409,
      error: "This client already has a suppression request or active suppression.",
    });
  });

  it("falls back to generic error message for unknown or unhandled errors", () => {
    const res = suppressionRpcFailure({
      code: "XX000",
      message: "internal postgres deadlock",
    });
    assert.deepEqual(res, {
      status: 500,
      error: "The suppression change could not be saved. Refresh the page and try again.",
    });
  });

  it("handles empty or blank error messages safely", () => {
    const res = suppressionRpcFailure({
      code: "42501",
      message: "   ",
    });
    assert.deepEqual(res, {
      status: 500,
      error: "The suppression change could not be saved. Refresh the page and try again.",
    });
  });
});
