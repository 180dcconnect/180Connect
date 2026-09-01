import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DashboardOrgRow } from "../dashboard-metrics.ts";
import { myWorkHref, myWorkSummary, type MyWorkBucket } from "./my-work.ts";

const ME = "user-me";
const THEM = "user-them";

function org(overrides: Partial<DashboardOrgRow> = {}): DashboardOrgRow {
  return {
    id: "org-1",
    legal_name: "Test Charity",
    outreach_status: "not_contacted",
    owner_id: null,
    updated_at: "2026-09-01T00:00:00Z",
    created_at: "2026-09-01T00:00:00Z",
    ...overrides,
  };
}

const bucket = (summary: ReturnType<typeof myWorkSummary>, key: MyWorkBucket["key"]) =>
  summary.buckets.find((entry) => entry.key === key)!;

describe("myWorkSummary", () => {
  it("reports zero owned for an empty pipeline", () => {
    const summary = myWorkSummary([], ME);
    assert.equal(summary.owned, 0);
    assert.deepEqual(
      summary.buckets.map((entry) => entry.count),
      [0, 0, 0, 0],
    );
  });

  it("counts only rows this actor owns", () => {
    const rows = [
      org({ id: "a", owner_id: ME }),
      org({ id: "b", owner_id: THEM }),
      org({ id: "c", owner_id: null }),
    ];
    assert.equal(myWorkSummary(rows, ME).owned, 1);
  });

  it("splits awaiting-reply across both sent statuses", () => {
    const rows = [
      org({ id: "a", owner_id: ME, outreach_status: "initial_outreach_sent" }),
      org({ id: "b", owner_id: ME, outreach_status: "follow_up_sent" }),
      org({ id: "c", owner_id: ME, outreach_status: "responded" }),
    ];
    assert.equal(bucket(myWorkSummary(rows, ME), "awaiting_reply").count, 2);
  });

  it("counts only `responded` as needing action, not resolved outcomes", () => {
    const rows = [
      org({ id: "a", owner_id: ME, outreach_status: "responded" }),
      org({ id: "b", owner_id: ME, outreach_status: "converted" }),
      org({ id: "c", owner_id: ME, outreach_status: "hard_no" }),
      org({ id: "d", owner_id: ME, outreach_status: "soft_no" }),
      org({ id: "e", owner_id: ME, outreach_status: "future_potential" }),
    ];
    assert.equal(bucket(myWorkSummary(rows, ME), "needs_action").count, 1);
  });

  it("counts not-yet-contacted from the owned rows only", () => {
    const rows = [
      org({ id: "a", owner_id: ME }),
      org({ id: "b", owner_id: ME }),
      org({ id: "c", owner_id: THEM }),
    ];
    assert.equal(bucket(myWorkSummary(rows, ME), "not_started").count, 2);
  });

  it("does not report conversions — that reading belongs to Performance", () => {
    const summary = myWorkSummary([org({ owner_id: ME, outreach_status: "converted" })], ME);
    assert.ok(!summary.buckets.some((entry) => /conver/i.test(entry.label)));
  });
});

describe("myWorkHref", () => {
  it("filters on owner alone for the all-mine bucket", () => {
    const summary = myWorkSummary([org({ owner_id: ME })], ME);
    assert.equal(myWorkHref(bucket(summary, "owned"), ME), `/clients?owner=${ME}`);
  });

  it("repeats the status parameter once per status, as the list expects", () => {
    const summary = myWorkSummary([org({ owner_id: ME })], ME);
    assert.equal(
      myWorkHref(bucket(summary, "awaiting_reply"), ME),
      `/clients?owner=${ME}&status=initial_outreach_sent&status=follow_up_sent`,
    );
  });
});
