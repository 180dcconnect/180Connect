import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { labelForStatus, styleForStatus } from "./status-helpers.ts";

describe("labelForStatus", () => {
  it("maps each known job_status to its display label", () => {
    assert.equal(labelForStatus("completed"), "Succeeded");
    assert.equal(labelForStatus("partial"), "Partially succeeded");
    assert.equal(labelForStatus("failed"), "Failed");
    assert.equal(labelForStatus("running"), "Running");
  });

  it("falls back to the raw status string for an unknown value", () => {
    assert.equal(labelForStatus("something_new"), "something_new");
  });
});

describe("styleForStatus", () => {
  it("gives failed a red style and completed a green style", () => {
    assert.match(styleForStatus("failed"), /red/);
    assert.match(styleForStatus("completed"), /green/);
  });

  it("falls back to a neutral gray style for an unknown value", () => {
    assert.match(styleForStatus("something_new"), /gray/);
  });
});