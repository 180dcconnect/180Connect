import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PIPELINE_STATUSES } from "../organisation-format.ts";
import { nextStatusAfterSend } from "./status-after-send.ts";

describe("nextStatusAfterSend (F147)", () => {
  it("moves a not-yet-contacted client to initial_outreach_sent on the first send (AC1)", () => {
    assert.equal(nextStatusAfterSend("not_contacted"), "initial_outreach_sent");
  });

  it("never lands on initial_outreach_sent twice — a second send reads follow_up_sent (AC2)", () => {
    assert.equal(nextStatusAfterSend("initial_outreach_sent"), "follow_up_sent");
    assert.equal(nextStatusAfterSend("follow_up_sent"), "follow_up_sent");
  });

  it("keeps a later send off 'initial' even after a manual detour elsewhere in the pipeline", () => {
    for (const status of ["responded", "converted", "soft_no", "no_response", "loss_due_timing"]) {
      assert.equal(nextStatusAfterSend(status), "follow_up_sent", status);
    }
  });

  it("only ever returns values from the defined pipeline set", () => {
    for (const status of PIPELINE_STATUSES) {
      assert.ok(
        (PIPELINE_STATUSES as readonly string[]).includes(nextStatusAfterSend(status)),
        `sending from ${status} produced a value outside PIPELINE_STATUSES`,
      );
    }
  });
});
