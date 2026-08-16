import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  MAX_BULK_STATUS_CLIENTS,
  bulkStatusBlockedReason,
  bulkStatusSummary,
  canBulkUpdateStatus,
  parseBulkStatusResult,
  setOutreachStatusBulkRpcFailure,
} from "./bulk-status.ts";

describe("setOutreachStatusBulkRpcFailure", () => {
  it("passes through the RPC's own message when the batch holds a client the CAM does not own", () => {
    assert.deepEqual(
      setOutreachStatusBulkRpcFailure({
        code: "42501",
        message: "you can only change the status of clients you own (2 of 20 selected are not yours)",
      }),
      {
        status: 403,
        error: "you can only change the status of clients you own (2 of 20 selected are not yours)",
      },
    );
  });

  it("maps a missing client to 404", () => {
    assert.deepEqual(
      setOutreachStatusBulkRpcFailure({
        code: "P0002",
        message: "one or more of those clients could not be found",
      }),
      { status: 404, error: "one or more of those clients could not be found" },
    );
  });

  it("maps an empty selection to 400, not a server error", () => {
    assert.deepEqual(
      setOutreachStatusBulkRpcFailure({
        code: "22023",
        message: "select at least one client before changing status",
      }),
      { status: 400, error: "select at least one client before changing status" },
    );
  });

  it("never leaks internals for an unexpected error", () => {
    const result = setOutreachStatusBulkRpcFailure({
      code: "22P02",
      message: 'invalid input value for enum outreach_status: "bogus"',
    });
    assert.equal(result.status, 500);
    assert.doesNotMatch(result.error, /enum|outreach_status/i);
  });

  it("tells the CAM nothing was updated, since the batch is one transaction", () => {
    const result = setOutreachStatusBulkRpcFailure({ code: "XX000", message: "boom" });
    assert.match(result.error, /nothing was updated/i);
  });

  it("does not emit an empty message when the RPC sent none", () => {
    const result = setOutreachStatusBulkRpcFailure({ code: "42501", message: "   " });
    assert.equal(result.status, 500);
    assert.match(result.error, /\S/);
  });
});

describe("parseBulkStatusResult", () => {
  it("reads the RPC's counts", () => {
    assert.deepEqual(parseBulkStatusResult({ requested: 5, changed: 3, unchanged: 2 }), {
      requested: 5,
      changed: 3,
      unchanged: 2,
    });
  });

  it("rejects a malformed payload rather than reporting zero changes", () => {
    assert.equal(parseBulkStatusResult(null), null);
    assert.equal(parseBulkStatusResult("3"), null);
    assert.equal(parseBulkStatusResult({ requested: 5, changed: "3", unchanged: 2 }), null);
    assert.equal(parseBulkStatusResult({ changed: 3 }), null);
  });
});

describe("bulkStatusSummary", () => {
  it("reports a clean batch", () => {
    assert.equal(
      bulkStatusSummary({ requested: 4, changed: 4, unchanged: 0 }, "follow_up_sent"),
      "4 clients moved to Follow up sent.",
    );
  });

  it("never hides the clients that were already on that status", () => {
    assert.equal(
      bulkStatusSummary({ requested: 20, changed: 15, unchanged: 5 }, "responded"),
      "15 clients moved to Responded. 5 others were already on it.",
    );
  });

  it("singularises both halves", () => {
    assert.equal(
      bulkStatusSummary({ requested: 2, changed: 1, unchanged: 1 }, "converted"),
      "1 client moved to Converted. 1 other was already on it.",
    );
  });

  it("says so plainly when the whole batch was a no-op", () => {
    assert.equal(
      bulkStatusSummary({ requested: 3, changed: 0, unchanged: 3 }, "hard_no"),
      "No change — all 3 selected clients were already on Hard no.",
    );
    assert.equal(
      bulkStatusSummary({ requested: 1, changed: 0, unchanged: 1 }, "hard_no"),
      "No change — that client was already on Hard no.",
    );
  });
});

describe("canBulkUpdateStatus", () => {
  const admin = { id: "admin-1", role: "admin" };
  const cam = { id: "cam-1", role: "cam" };
  const viewer = { id: "viewer-1", role: "viewer" };

  it("lets an admin select any client, owned or not", () => {
    assert.equal(canBulkUpdateStatus(admin, { owner_id: null }), true);
    assert.equal(canBulkUpdateStatus(admin, { owner_id: "cam-1" }), true);
  });

  it("lets a CAM select only their own clients", () => {
    assert.equal(canBulkUpdateStatus(cam, { owner_id: "cam-1" }), true);
    assert.equal(canBulkUpdateStatus(cam, { owner_id: "cam-2" }), false);
  });

  it("does not treat an unowned client as a CAM's own", () => {
    assert.equal(canBulkUpdateStatus(cam, { owner_id: null }), false);
  });

  it("never lets a viewer select anything", () => {
    assert.equal(canBulkUpdateStatus(viewer, { owner_id: null }), false);
    assert.equal(canBulkUpdateStatus(viewer, { owner_id: "viewer-1" }), false);
  });

  it("mirrors the RPC's rule: bulk grants nothing a single update would not", () => {
    // The guard against the escalation this feature could otherwise become —
    // if this ever passes for a client a CAM cannot edit one at a time, the
    // bulk path has become a way around the single path.
    assert.equal(canBulkUpdateStatus(cam, { owner_id: "someone-else" }), false);
  });
});

describe("bulkStatusBlockedReason", () => {
  const cam = { id: "cam-1", role: "cam" };

  it("says nothing for a row the actor can act on", () => {
    assert.equal(bulkStatusBlockedReason(cam, { owner_id: "cam-1" }), null);
  });

  it("points an unowned row at the claim flow rather than at ownership", () => {
    assert.match(bulkStatusBlockedReason(cam, { owner_id: null }) ?? "", /claim/i);
  });

  it("explains someone else's row without naming them", () => {
    const reason = bulkStatusBlockedReason(cam, { owner_id: "cam-2" }) ?? "";
    assert.match(reason, /owner or an admin/i);
    assert.doesNotMatch(reason, /cam-2/);
  });

  it("explains a read-only role", () => {
    assert.match(
      bulkStatusBlockedReason({ id: "v", role: "viewer" }, { owner_id: "v" }) ?? "",
      /CAM or an admin/i,
    );
  });
});

describe("MAX_BULK_STATUS_CLIENTS", () => {
  it("matches the ceiling the RPC enforces", () => {
    // Both halves of the cap are load-bearing: this one keeps the UI from
    // assembling a selection the database will refuse. Changing one without
    // the other turns a clear client-side message into a 400 from the server.
    assert.equal(MAX_BULK_STATUS_CLIENTS, 500);
  });
});
