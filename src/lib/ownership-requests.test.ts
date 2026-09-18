import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  decidedRequestNotice,
  ownershipRequestAvailability,
  ownershipRequestRpcFailure,
  pendingRequestNotice,
} from "./ownership-requests.ts";

const CAM = "00000000-0000-4000-a000-000000000001";
const OTHER_CAM = "00000000-0000-4000-a000-000000000002";

describe("ownershipRequestAvailability (#408)", () => {
  it("offers the request when another CAM owns the client", () => {
    assert.deepEqual(
      ownershipRequestAvailability({
        ownerId: OTHER_CAM,
        actorId: CAM,
        actorRole: "cam",
        hasPendingRequest: false,
      }),
      { available: true },
    );
  });

  it("does not offer it to an admin, who reassigns directly", () => {
    assert.deepEqual(
      ownershipRequestAvailability({
        ownerId: OTHER_CAM,
        actorId: CAM,
        actorRole: "admin",
        hasPendingRequest: false,
      }),
      { available: false, reason: "not_cam" },
    );
  });

  it("does not offer it to a viewer", () => {
    assert.deepEqual(
      ownershipRequestAvailability({
        ownerId: OTHER_CAM,
        actorId: CAM,
        actorRole: "viewer",
        hasPendingRequest: false,
      }),
      { available: false, reason: "not_cam" },
    );
  });

  it("sends an unowned client down the claim path instead", () => {
    assert.deepEqual(
      ownershipRequestAvailability({
        ownerId: null,
        actorId: CAM,
        actorRole: "cam",
        hasPendingRequest: false,
      }),
      { available: false, reason: "unowned" },
    );
  });

  it("does not offer it for a client the CAM already owns", () => {
    assert.deepEqual(
      ownershipRequestAvailability({
        ownerId: CAM,
        actorId: CAM,
        actorRole: "cam",
        hasPendingRequest: false,
      }),
      { available: false, reason: "already_owner" },
    );
  });

  it("does not offer a second request while one is pending", () => {
    assert.deepEqual(
      ownershipRequestAvailability({
        ownerId: OTHER_CAM,
        actorId: CAM,
        actorRole: "cam",
        hasPendingRequest: true,
      }),
      { available: false, reason: "already_pending" },
    );
  });
});

describe("ownershipRequestRpcFailure (#408)", () => {
  it("passes through a deliberate permission refusal", () => {
    assert.deepEqual(
      ownershipRequestRpcFailure({ code: "42501", message: "only an admin may decide" }),
      { status: 403, error: "only an admin may decide" },
    );
  });

  it("maps a blank reason to 400", () => {
    assert.equal(ownershipRequestRpcFailure({ code: "23514", message: "a reason is required" }).status, 400);
  });

  it("maps a duplicate or already-decided request to 409", () => {
    assert.equal(ownershipRequestRpcFailure({ code: "23505", message: "already pending" }).status, 409);
    assert.equal(ownershipRequestRpcFailure({ code: "55000", message: "already decided" }).status, 409);
  });

  it("maps a missing target to 404", () => {
    assert.equal(ownershipRequestRpcFailure({ code: "P0002", message: "not found" }).status, 404);
  });

  it("hides an unexpected error behind a generic message", () => {
    const failure = ownershipRequestRpcFailure({
      code: "42P01",
      message: 'relation "public.ownership_requests" does not exist',
    });
    assert.equal(failure.status, 500);
    assert.equal(failure.error, "The ownership request could not be saved. Refresh and try again.");
    assert.ok(!failure.error.includes("relation"));
  });

  it("hides a message-less error too", () => {
    assert.equal(ownershipRequestRpcFailure({ code: "42501", message: "  " }).status, 500);
  });
});

describe("ownership request notices (#408)", () => {
  it("names the current owner in the pending notice", () => {
    assert.equal(
      pendingRequestNotice("Mohammed Saeed"),
      "You have asked an admin to hand this client over from Mohammed Saeed. It is still pending — ownership has not changed.",
    );
  });

  it("falls back when the owner name is unknown", () => {
    assert.ok(pendingRequestNotice(null).includes("another team member"));
  });

  it("says ownership did not change on a rejection", () => {
    assert.equal(
      decidedRequestNotice("rejected"),
      "An admin declined your request for this client. Ownership has not changed.",
    );
  });

  it("appends the admin's note when there is one", () => {
    assert.equal(
      decidedRequestNotice("approved", "Sarah is handing over her portfolio."),
      "An admin approved your request for this client. Note: Sarah is handing over her portfolio.",
    );
  });
});
