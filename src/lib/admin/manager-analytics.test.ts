import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { DashboardOrgRow } from "../dashboard-metrics.ts";
import type { CamReplyRow, SentMessageRow } from "../cam-analytics.ts";
import {
  conversionsOverTime,
  perCamAnalytics,
  sortByNeed,
  teamTotals,
  type OutcomeRow,
} from "./manager-analytics.ts";

let sequence = 0;
const nextId = (prefix: string) => `${prefix}-${(sequence += 1)}`;

function org(overrides: Partial<DashboardOrgRow> = {}): DashboardOrgRow {
  const id = overrides.id ?? nextId("org");
  return {
    id,
    legal_name: `Charity ${id}`,
    outreach_status: "initial_outreach_sent",
    owner_id: null,
    updated_at: "2026-09-01T00:00:00.000Z",
    created_at: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

function outcome(overrides: Partial<OutcomeRow> = {}): OutcomeRow {
  return {
    id: nextId("outcome"),
    organisation_id: nextId("org"),
    outcome_type: "converted",
    created_at: "2026-09-01T12:00:00.000Z",
    ...overrides,
  };
}

/** `count` clients for `owner`, all at the given status. */
const owned = (owner: string, count: number, status: string) =>
  Array.from({ length: count }, () => org({ owner_id: owner, outreach_status: status }));

const NOW = new Date("2026-09-03T00:00:00.000Z");
const NO_MESSAGES: SentMessageRow[] = [];
const NO_REPLIES: CamReplyRow[] = [];

describe("conversionsOverTime (F210)", () => {
  it("emits one point per day across the window, zero on quiet days", () => {
    const series = conversionsOverTime([], 7, NOW);

    assert.equal(series.length, 7);
    assert.equal(series[0].date, "2026-08-28");
    assert.equal(series[6].date, "2026-09-03");
    assert.ok(series.every((point) => point.value === 0));
  });

  it("counts new conversions on the day they were recorded", () => {
    const series = conversionsOverTime(
      [
        outcome({ created_at: "2026-09-01T09:00:00.000Z" }),
        outcome({ created_at: "2026-09-01T18:00:00.000Z" }),
        outcome({ created_at: "2026-09-03T01:00:00.000Z" }),
      ],
      7,
      NOW,
    );

    assert.equal(series.find((point) => point.date === "2026-09-01")?.value, 2);
    assert.equal(series.find((point) => point.date === "2026-09-03")?.value, 1);
    assert.equal(series.find((point) => point.date === "2026-09-02")?.value, 0);
  });

  it("counts conversions only, ignoring the other outcome types", () => {
    const series = conversionsOverTime(
      [
        outcome({ outcome_type: "no_response", created_at: "2026-09-01T09:00:00.000Z" }),
        outcome({ outcome_type: "soft_no", created_at: "2026-09-01T09:00:00.000Z" }),
        outcome({ outcome_type: "reply", created_at: "2026-09-01T09:00:00.000Z" }),
      ],
      7,
      NOW,
    );

    assert.ok(series.every((point) => point.value === 0));
  });

  it("drops outcomes outside the window and unparseable timestamps", () => {
    const series = conversionsOverTime(
      [
        outcome({ created_at: "2026-01-01T09:00:00.000Z" }),
        outcome({ created_at: "not a date" }),
      ],
      7,
      NOW,
    );

    assert.ok(series.every((point) => point.value === 0));
  });

  it("returns nothing for a window of less than a day", () => {
    assert.deepEqual(conversionsOverTime([outcome()], 0, NOW), []);
  });
});

describe("perCamAnalytics (F212)", () => {
  const cams = [
    { id: "cam-a", name: "Ada" },
    { id: "cam-b", name: "Blake" },
  ];

  it("keeps a CAM who owns nothing in the list rather than dropping them", () => {
    const rows = perCamAnalytics(owned("cam-a", 2, "converted"), NO_MESSAGES, NO_REPLIES, cams);

    assert.deepEqual(
      rows.map((row) => row.camName),
      ["Ada", "Blake"],
    );
    assert.equal(rows[1].totals.clientsOwned, 0);
    assert.deepEqual(rows[1].flags, []);
  });

  it("never lets one CAM's clients contribute to another's row", () => {
    const rows = perCamAnalytics(
      [...owned("cam-a", 3, "converted"), ...owned("cam-b", 1, "converted")],
      NO_MESSAGES,
      NO_REPLIES,
      cams,
    );

    assert.equal(rows[0].totals.conversions, 3);
    assert.equal(rows[1].totals.conversions, 1);
  });

  it("flags a CAM who owns clients but has contacted none", () => {
    const rows = perCamAnalytics(owned("cam-a", 3, "not_contacted"), NO_MESSAGES, NO_REPLIES, cams);

    assert.deepEqual(
      rows[0].flags.map((flag) => flag.kind),
      ["no_outreach"],
    );
  });

  it("flags a CAM converting at under half the team median", () => {
    const rows = perCamAnalytics(
      [
        // Ada: 8 of 10 contacted convert.
        ...owned("cam-a", 8, "converted"),
        ...owned("cam-a", 2, "no_response"),
        // Blake: 1 of 10.
        ...owned("cam-b", 1, "converted"),
        ...owned("cam-b", 9, "no_response"),
      ],
      NO_MESSAGES,
      NO_REPLIES,
      cams,
    );

    const blake = rows.find((row) => row.camId === "cam-b");
    assert.ok(blake);
    assert.ok(blake.flags.some((flag) => flag.kind === "low_conversion"));

    const ada = rows.find((row) => row.camId === "cam-a");
    assert.ok(ada);
    assert.equal(ada.flags.length, 0);
  });

  it("does not judge a CAM who has barely started", () => {
    // Two contacted clients is not a conversion rate worth comparing.
    const rows = perCamAnalytics(
      [
        ...owned("cam-a", 8, "converted"),
        ...owned("cam-a", 2, "no_response"),
        ...owned("cam-b", 2, "no_response"),
      ],
      NO_MESSAGES,
      NO_REPLIES,
      cams,
    );

    const blake = rows.find((row) => row.camId === "cam-b");
    assert.ok(blake);
    assert.deepEqual(blake.flags, []);
  });
});

describe("teamTotals and sortByNeed (F212)", () => {
  const cams = [
    { id: "cam-a", name: "Ada" },
    { id: "cam-b", name: "Blake" },
  ];

  it("sums the per-CAM rows and counts who is flagged", () => {
    const rows = perCamAnalytics(
      [
        ...owned("cam-a", 8, "converted"),
        ...owned("cam-a", 2, "no_response"),
        ...owned("cam-b", 1, "converted"),
        ...owned("cam-b", 9, "no_response"),
      ],
      NO_MESSAGES,
      NO_REPLIES,
      cams,
    );

    const totals = teamTotals(rows);

    assert.equal(totals.cams, 2);
    assert.equal(totals.clientsOwned, 20);
    assert.equal(totals.conversions, 9);
    assert.equal(totals.camsNeedingSupport, 1);
  });

  it("puts flagged CAMs at the top", () => {
    const rows = perCamAnalytics(
      [
        ...owned("cam-a", 8, "converted"),
        ...owned("cam-a", 2, "no_response"),
        ...owned("cam-b", 1, "converted"),
        ...owned("cam-b", 9, "no_response"),
      ],
      NO_MESSAGES,
      NO_REPLIES,
      cams,
    );

    assert.equal(sortByNeed(rows)[0].camId, "cam-b");
  });

  it("reports zeros for an empty team rather than throwing", () => {
    const totals = teamTotals([]);

    assert.equal(totals.cams, 0);
    assert.equal(totals.conversions, 0);
    assert.equal(totals.camsNeedingSupport, 0);
  });
});
