import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  BACKFILL_BATCH_SIZE,
  MANUAL_BACKFILL_BATCH_SIZE,
  MANUAL_BACKFILL_MAX,
  REFETCH_AFTER_DAYS,
  cutoffIso,
  drainBackfillQueue,
  resolveManualBatchSize,
  selectDueOrganisations,
  type BackfillStore,
  type OrgFetchState,
} from "./three-sixty-giving-backfill.ts";

const NOW = new Date("2026-09-04T12:00:00.000Z");
const CUTOFF = cutoffIso(NOW);

type Recorded = {
  stamped: string[][];
  loadedLimits: number[];
  askedWith: string[][];
};

function fakeStore(
  overrides: Partial<BackfillStore> = {},
): { store: BackfillStore; recorded: Recorded } {
  const recorded: Recorded = { stamped: [], loadedLimits: [], askedWith: [] };

  const store: BackfillStore = {
    async loadDueOrganisations(limit) {
      recorded.loadedLimits.push(limit);
      return [];
    },
    async loadIdentifiersFor() {
      return [];
    },
    async markFetched(ids) {
      recorded.stamped.push(ids);
    },
    async countRemaining() {
      return { due: 0, total: 0 };
    },
    ...overrides,
  };

  return { store, recorded };
}

describe("cutoffIso", () => {
  it("is the refetch window before now", () => {
    const cutoff = cutoffIso(NOW, 90);
    assert.equal(cutoff, "2026-06-06T12:00:00.000Z");
  });

  it("defaults to the documented refetch window", () => {
    assert.equal(cutoffIso(NOW), cutoffIso(NOW, REFETCH_AFTER_DAYS));
  });
});

describe("resolveManualBatchSize", () => {
  it("accepts a number within range", () => {
    assert.equal(resolveManualBatchSize(50), 50);
  });

  it("coerces the FormData string the button submits", () => {
    assert.equal(resolveManualBatchSize("50"), 50);
  });

  it("falls back to the default when nothing was submitted", () => {
    assert.equal(resolveManualBatchSize(null), MANUAL_BACKFILL_BATCH_SIZE);
    assert.equal(resolveManualBatchSize(undefined), MANUAL_BACKFILL_BATCH_SIZE);
    assert.equal(resolveManualBatchSize(""), MANUAL_BACKFILL_BATCH_SIZE);
  });

  it("falls back to the default above the max rather than running it", () => {
    // A tampered value must never widen the slice past what fits the ceiling.
    assert.equal(resolveManualBatchSize(MANUAL_BACKFILL_MAX + 1), MANUAL_BACKFILL_BATCH_SIZE);
    assert.equal(resolveManualBatchSize(0), MANUAL_BACKFILL_BATCH_SIZE);
    assert.equal(resolveManualBatchSize(2.5), MANUAL_BACKFILL_BATCH_SIZE);
    assert.equal(resolveManualBatchSize("fifty"), MANUAL_BACKFILL_BATCH_SIZE);
  });
});

describe("selectDueOrganisations", () => {
  const state = (id: string, grants_fetched_at: string | null): OrgFetchState => ({
    id,
    grants_fetched_at,
  });

  it("leaves out suppressed organisations entirely", () => {
    const states = [state("org-a", null), state("org-b", null), state("org-c", null)];
    assert.deepEqual(
      selectDueOrganisations(states, new Set(["org-b"]), CUTOFF, 10),
      ["org-a", "org-c"],
    );
  });

  it("takes never-checked rows first, then oldest first", () => {
    const states = [
      state("fresh", "2026-03-01T00:00:00.000Z"),
      state("never", null),
      state("stale", "2026-01-01T00:00:00.000Z"),
    ];
    assert.deepEqual(selectDueOrganisations(states, new Set(), CUTOFF, 10), [
      "never",
      "stale",
      "fresh",
    ]);
  });

  it("treats the cutoff as strictly older-than, like the SQL it replaced", () => {
    const states = [state("edge", CUTOFF), state("due", "2026-01-01T00:00:00.000Z")];
    assert.deepEqual(selectDueOrganisations(states, new Set(), CUTOFF, 10), ["due"]);
  });

  it("respects the slice limit", () => {
    const states = [state("a", null), state("b", null), state("c", null)];
    assert.deepEqual(selectDueOrganisations(states, new Set(), CUTOFF, 2), ["a", "b"]);
  });
});

describe("drainBackfillQueue", () => {
  it("makes no external request when nothing is due", async () => {
    let asked = false;
    const { store } = fakeStore({
      async countRemaining() {
        return { due: 0, total: 1200 };
      },
    });

    const result = await drainBackfillQueue({
      store,
      now: NOW,
      fetchAndPromote: async () => {
        asked = true;
        return { grantsFound: 0, grantsMatched: 0 };
      },
    });

    // The property that makes a 15-minute schedule affordable: an idle run costs
    // one query and zero API calls.
    assert.equal(asked, false);
    assert.deepEqual(result, {
      walked: 0,
      asked: 0,
      grantsFound: 0,
      grantsMatched: 0,
      remaining: 0,
      total: 1200,
    });
  });

  it("takes a bounded slice, not the whole queue", async () => {
    const { store, recorded } = fakeStore();
    await drainBackfillQueue({ store, now: NOW });
    assert.deepEqual(recorded.loadedLimits, [BACKFILL_BATCH_SIZE]);
  });

  it("stamps every organisation in the slice once the batch is done", async () => {
    const { store, recorded } = fakeStore({
      async loadDueOrganisations() {
        return ["org-a", "org-b"];
      },
      async loadIdentifiersFor() {
        return [
          { organisation_id: "org-a", identifier_type: "uk_charity", identifier_value: "1164883" },
        ];
      },
      async countRemaining() {
        return { due: 5, total: 20 };
      },
    });

    const result = await drainBackfillQueue({
      store,
      now: NOW,
      fetchAndPromote: async () => ({ grantsFound: 3, grantsMatched: 2 }),
    });

    // org-b has no registry identifier, so 360Giving was never asked about it —
    // it is still stamped. "Nothing to ask with" is a settled answer, and leaving
    // it null would park it at the head of the queue forever.
    assert.deepEqual(recorded.stamped, [["org-a", "org-b"]]);
    assert.equal(result.walked, 2);
    assert.equal(result.asked, 1);
    assert.equal(result.grantsMatched, 2);
    assert.equal(result.remaining, 5);
  });

  it("stamps nothing when the fetch throws, so the slice is retried", async () => {
    const { store, recorded } = fakeStore({
      async loadDueOrganisations() {
        return ["org-a"];
      },
      async loadIdentifiersFor() {
        return [
          { organisation_id: "org-a", identifier_type: "uk_charity", identifier_value: "1164883" },
        ];
      },
    });

    await assert.rejects(
      drainBackfillQueue({
        store,
        now: NOW,
        fetchAndPromote: async () => {
          throw new Error("360Giving returned 502");
        },
      }),
      /502/,
    );

    // The whole point of stamping last: a failed run must leave the queue exactly
    // as it found it. Stamping first would drop these organisations silently,
    // and an organisation never asked about looks identical on screen to one
    // asked about with no result.
    assert.deepEqual(recorded.stamped, []);
  });

  it("skips the fetch when the slice has no registry identifiers at all", async () => {
    let asked = false;
    const { store, recorded } = fakeStore({
      async loadDueOrganisations() {
        return ["org-a", "org-b"];
      },
      async loadIdentifiersFor() {
        return [];
      },
    });

    const result = await drainBackfillQueue({
      store,
      now: NOW,
      fetchAndPromote: async () => {
        asked = true;
        return { grantsFound: 0, grantsMatched: 0 };
      },
    });

    assert.equal(asked, false);
    assert.equal(result.asked, 0);
    assert.equal(result.walked, 2);
    // Still cleared from the queue, or they would block it permanently.
    assert.deepEqual(recorded.stamped, [["org-a", "org-b"]]);
  });

  it("passes only the slice's identifiers to the walk", async () => {
    const seen: string[] = [];
    const { store } = fakeStore({
      async loadDueOrganisations() {
        return ["org-a"];
      },
      async loadIdentifiersFor() {
        return [
          { organisation_id: "org-a", identifier_type: "uk_charity", identifier_value: "1164883" },
          { organisation_id: "org-a", identifier_type: "uk_company", identifier_value: "09668396" },
        ];
      },
    });

    await drainBackfillQueue({
      store,
      now: NOW,
      fetchAndPromote: async (identifiers) => {
        seen.push(...identifiers.map((i) => `${i.identifier_type}:${i.identifier_value}`));
        return { grantsFound: 0, grantsMatched: 0 };
      },
    });

    assert.deepEqual(seen, ["uk_charity:1164883", "uk_company:09668396"]);
  });
});
