import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { hashPayload } from "./checksum.ts";
import { partitionRecords, runIngestion } from "./runner.ts";
import type { FieldRule } from "./field-filter.ts";
import type {
  CommonRecord,
  DataSourceAdapter,
  DataSourceName,
  IngestionStore,
  JobStatus,
  RawRecordRow,
  RunCounts,
  RunTrigger,
} from "./type.ts";

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

type FinishedRun = {
  runId: string;
  status: JobStatus;
  counts: RunCounts;
  errorMessage?: string;
};

/**
 * An in-memory IngestionStore. The runner talks to this interface rather than to
 * Supabase, so failure isolation and the counts can be asserted without a database.
 */
function fakeStore(
  overrides: Partial<IngestionStore> = {},
  seed: Record<string, { checksum: string; ingestion_attempt: number }> = {},
  seedRules: { rules: FieldRule[]; version: number } = { rules: [], version: 0 },
) {
  const started: { source: DataSourceName; trigger: RunTrigger }[] = [];
  const finished: FinishedRun[] = [];
  const written: RawRecordRow[] = [];
  let nextId = 1;

  const store: IngestionStore = {
    async startRun(source, trigger) {
      started.push({ source, trigger });
      return { id: `run-${nextId++}` };
    },
    async loadChecksums(_source, ids) {
      const map = new Map<
        string,
        { checksum: string; ingestion_attempt: number }
      >();
      for (const id of ids) {
        if (seed[id]) map.set(id, seed[id]);
      }
      return map;
    },
    async writeRecords(rows) {
      written.push(...rows);
    },
    async finishRun(runId, status, counts, errorMessage) {
      finished.push({ runId, status, counts: { ...counts }, errorMessage });
    },
    async loadDataHandlingRules() {
      return seedRules;
    },
    ...overrides,
  };

  return { store, started, finished, written };
}

function record(id: string, payload: unknown = { id }): CommonRecord {
  return { source_record_id: id, raw_payload: payload };
}

function adapter(
  name: DataSourceName,
  result: () => Promise<{ records: CommonRecord[]; truncated: boolean }>,
): DataSourceAdapter & { errors: Error[] } {
  const errors: Error[] = [];
  return {
    name,
    fetch: result,
    onError(err) {
      errors.push(err);
    },
    errors,
  };
}

const ok = (records: CommonRecord[], truncated = false) => async () => ({
  records,
  truncated,
});

// ---------------------------------------------------------------------------

describe("partitionRecords", () => {
  const empty = new Map<
    string,
    { checksum: string; ingestion_attempt: number }
  >();

  it("writes every record the first time it sees them", () => {
    const result = partitionRecords(
      [record("A"), record("B")],
      empty,
      "run-1",
      "companies_house",
    );
    assert.equal(result.rows.length, 2);
    assert.equal(result.skipped, 0);
    assert.equal(result.changed, 0);
    assert.deepEqual(result.invalid, []);
    assert.equal(result.rows[0].ingestion_attempt, 1);
  });

  it("skips a record whose checksum is unchanged", () => {
    const existing = new Map([
      ["A", { checksum: hashPayload({ id: "A" }), ingestion_attempt: 1 }],
    ]);
    const result = partitionRecords(
      [record("A")],
      existing,
      "run-1",
      "companies_house",
    );
    assert.equal(result.rows.length, 0);
    assert.equal(result.skipped, 1);
  });

  it("rewrites a record whose payload changed and bumps ingestion_attempt", () => {
    const existing = new Map([
      ["A", { checksum: "stale", ingestion_attempt: 3 }],
    ]);
    const result = partitionRecords(
      [record("A")],
      existing,
      "run-1",
      "companies_house",
    );
    assert.equal(result.rows.length, 1);
    assert.equal(result.changed, 1);
    assert.equal(result.rows[0].ingestion_attempt, 4);
  });

  it("detects a change in a deeply nested field", () => {
    const before = { company_number: "A", address: { locality: "London" } };
    const after = { company_number: "A", address: { locality: "Manchester" } };
    const existing = new Map([
      ["A", { checksum: hashPayload(before), ingestion_attempt: 1 }],
    ]);
    const result = partitionRecords(
      [record("A", after)],
      existing,
      "run-1",
      "companies_house",
    );
    assert.equal(result.rows.length, 1, "a nested change must not be skipped");
  });

  it("rejects a record with no source_record_id instead of failing the batch", () => {
    const records = [
      record("A"),
      { source_record_id: undefined, raw_payload: { x: 1 } },
      record("B"),
    ] as unknown as CommonRecord[];

    const result = partitionRecords(records, empty, "run-1", "companies_house");
    assert.equal(result.rows.length, 2, "the good records still get written");
    assert.equal(result.invalid.length, 1);
    assert.match(result.invalid[0].reason, /source_record_id/);
  });

  it("rejects a blank source_record_id and a null payload", () => {
    const records = [
      { source_record_id: "   ", raw_payload: { x: 1 } },
      { source_record_id: "C", raw_payload: null },
    ] as unknown as CommonRecord[];

    const result = partitionRecords(records, empty, "run-1", "companies_house");
    assert.equal(result.rows.length, 0);
    assert.equal(result.invalid.length, 2);
  });

  it("collapses duplicates within one batch, keeping the first", () => {
    // Postgres rejects an ON CONFLICT DO UPDATE that hits the same row twice.
    const result = partitionRecords(
      [record("A", { v: 1 }), record("A", { v: 2 })],
      empty,
      "run-1",
      "companies_house",
    );
    assert.equal(result.rows.length, 1);
    assert.equal(result.skipped, 1);
    assert.deepEqual(result.rows[0].raw_payload, { v: 1 });
  });

  it("accounts for every record exactly once", () => {
    const records = [
      record("A"),
      record("A"),
      { source_record_id: "", raw_payload: {} },
    ] as unknown as CommonRecord[];
    const result = partitionRecords(records, empty, "run-1", "companies_house");
    assert.equal(
      result.rows.length + result.skipped + result.invalid.length,
      records.length,
    );
  });

  it("strips denied fields from raw_payload when rules are provided (F246)", () => {
    const payload = {
      company_name: "Acme",
      officers: [
        { name: "Alice", date_of_birth: "1990-01-01" },
      ],
    };
    const rules: FieldRule[] = [
      { source: "companies_house", field_path: "officers[*].date_of_birth", action: "deny" },
    ];
    const result = partitionRecords(
      [record("A", payload)],
      empty,
      "run-1",
      "companies_house",
      rules,
      1,
    );
    assert.equal(result.rows.length, 1);
    const written = result.rows[0];
    assert.deepEqual(written.raw_payload, {
      company_name: "Acme",
      officers: [{ name: "Alice" }],
    });
    assert.deepEqual(written.excluded_fields, ["officers[*].date_of_birth"]);
    assert.equal(written.rule_version_applied, 1);
  });

  it("records an empty excluded_fields when the rules ran and matched nothing", () => {
    // [] and null are not interchangeable here: [] is the evidence that the rules
    // were applied to this record, which is what an audit of the policy asks for.
    const payload = { company_name: "Acme" };
    const rules: FieldRule[] = [
      { source: "companies_house", field_path: "officers[*].date_of_birth", action: "deny" },
    ];
    const result = partitionRecords(
      [record("A", payload)],
      empty,
      "run-1",
      "companies_house",
      rules,
      1,
    );
    assert.equal(result.rows.length, 1);
    assert.deepEqual(result.rows[0].excluded_fields, []);
    assert.equal(result.rows[0].rule_version_applied, 1);
  });

  it("records null excluded_fields only when no rule version was applied", () => {
    const result = partitionRecords(
      [record("A", { company_name: "Acme" })],
      empty,
      "run-1",
      "companies_house",
    );
    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0].excluded_fields, null);
    assert.equal(result.rows[0].rule_version_applied, null);
  });

  it("stamps the rule version even when no rules are seeded yet (version 0)", () => {
    const result = partitionRecords(
      [record("A", { company_name: "Acme" })],
      empty,
      "run-1",
      "companies_house",
      [],
      0,
    );
    assert.deepEqual(result.rows[0].excluded_fields, []);
    assert.equal(result.rows[0].rule_version_applied, 0);
  });
});

describe("runIngestion", () => {
  it("records a completed run with reconciling counts", async () => {
    const { store, finished, written } = fakeStore();
    const source = adapter("companies_house", ok([record("A"), record("B")]));

    const [summary] = await runIngestion([source], undefined, store);

    assert.equal(summary.status, "completed");
    assert.deepEqual(summary.counts, {
      fetched: 2,
      inserted: 2,
      skipped: 0,
      failed: 0,
    });
    assert.equal(written.length, 2);
    assert.equal(finished[0].status, "completed");
  });

  it("passes the trigger through instead of hardcoding manual", async () => {
    const { store, started } = fakeStore();
    const source = adapter("companies_house", ok([]));

    await runIngestion(
      [source],
      { triggeredBy: "schedule", triggeredByUserId: null },
      store,
    );

    assert.equal(started[0].trigger.triggeredBy, "schedule");
  });

  it("reports partial when the source truncated its results", async () => {
    const { store, finished } = fakeStore();
    const source = adapter("companies_house", ok([record("A")], true));

    const [summary] = await runIngestion([source], undefined, store);

    assert.equal(summary.status, "partial");
    assert.equal(finished[0].status, "partial");
  });

  it("reports partial, not failed, when some records are unusable", async () => {
    const { store } = fakeStore();
    const source = adapter(
      "companies_house",
      ok([record("A"), { raw_payload: {} } as unknown as CommonRecord]),
    );

    const [summary] = await runIngestion([source], undefined, store);

    assert.equal(summary.status, "partial");
    assert.equal(summary.counts.failed, 1);
    assert.equal(summary.counts.inserted, 1);
  });

  // AC2: "a failure in one source's import does not affect another source's import
  // running at the same time."
  it("isolates a failing source from the others running alongside it", async () => {
    const { store, finished } = fakeStore();
    const broken = adapter("charitybase", async () => {
      throw new Error("boom");
    });
    const healthy = adapter("companies_house", ok([record("A")]));

    const summaries = await runIngestion([broken, healthy], undefined, store);

    assert.equal(summaries[0].status, "failed");
    assert.equal(summaries[0].error, "boom");
    assert.equal(broken.errors[0].message, "boom");
    assert.equal(summaries[1].status, "completed");
    assert.equal(summaries[1].counts.inserted, 1);
    assert.equal(
      finished.find((f) => f.status === "failed")?.errorMessage,
      "boom",
      "the failure reason reaches error_message",
    );
  });

  it("runs the sources concurrently rather than one after another", async () => {
    const { store } = fakeStore();
    const order: string[] = [];

    const slow = adapter("charitybase", async () => {
      order.push("slow:start");
      await new Promise((resolve) => setTimeout(resolve, 30));
      order.push("slow:end");
      return { records: [], truncated: false };
    });
    const fast = adapter("companies_house", async () => {
      order.push("fast:start");
      order.push("fast:end");
      return { records: [], truncated: false };
    });

    await runIngestion([slow, fast], undefined, store);

    // Sequential would be slow:start, slow:end, fast:start. Concurrent starts the
    // fast source while the slow one is still waiting.
    assert.deepEqual(order, [
      "slow:start",
      "fast:start",
      "fast:end",
      "slow:end",
    ]);
  });

  it("keeps going when a source cannot even open a run row", async () => {
    let calls = 0;
    const { store } = fakeStore({
      async startRun(source) {
        calls++;
        if (source === "charitybase") throw new Error("insert denied");
        return { id: `run-${calls}` };
      },
    });
    const broken = adapter("charitybase", ok([record("A")]));
    const healthy = adapter("companies_house", ok([record("B")]));

    const summaries = await runIngestion([broken, healthy], undefined, store);

    assert.equal(summaries[0].status, "failed");
    assert.equal(summaries[0].error, "insert denied");
    assert.equal(summaries[1].status, "completed");
  });

  it("reports the real counts when the write fails, not zeros", async () => {
    const { store, finished } = fakeStore({
      async writeRecords() {
        throw new Error("write blew up");
      },
    });
    const source = adapter(
      "companies_house",
      ok([record("A"), record("B"), record("C")]),
    );

    const [summary] = await runIngestion([source], undefined, store);

    assert.equal(summary.status, "failed");
    assert.equal(summary.counts.fetched, 3, "fetched must not be reset to 0");
    assert.equal(summary.counts.failed, 3);
    assert.equal(finished[0].errorMessage, "write blew up");
  });

  it("does not let a failing finishRun strand the other sources", async () => {
    const { store } = fakeStore({
      async writeRecords() {
        throw new Error("write blew up");
      },
      async finishRun() {
        throw new Error("finish blew up");
      },
    });
    const broken = adapter("charitybase", ok([record("A")]));
    const healthy = adapter("companies_house", ok([record("B")]));

    const summaries = await runIngestion([broken, healthy], undefined, store);

    assert.equal(summaries.length, 2);
    assert.equal(summaries[0].status, "failed");
    // The second source also fails on write here, but it got its turn — the point
    // is that the first source's finishRun throw did not escape the runner.
    assert.equal(summaries[1].status, "failed");
  });

  it("throws a clear error when no store is configured", async () => {
    await assert.rejects(
      () => runIngestion([], undefined, null),
      /SUPABASE_SERVICE_ROLE_KEY/,
    );
  });

  it("refuses to import anything when the data handling rules cannot be read (F246)", async () => {
    // Fail-closed. Importing unfiltered would store exactly the personal data the
    // rules exist to exclude, and would do it without anyone noticing.
    const { store, started, written } = fakeStore({
      async loadDataHandlingRules() {
        throw new Error("relation \"data_handling_rules\" does not exist");
      },
    });
    const source = adapter("companies_house", ok([record("A")]));

    await assert.rejects(
      () => runIngestion([source], undefined, store),
      /Data handling rules could not be loaded/,
    );

    // No run row opened and nothing written — there is no half-run to reconcile.
    assert.equal(started.length, 0);
    assert.equal(written.length, 0);
  });

  it("passes the loaded rules and version through to the written rows (F246)", async () => {
    const { store, written } = fakeStore(
      {},
      {},
      {
        rules: [
          {
            source: null,
            field_path: "ethnicity",
            action: "deny",
          },
        ],
        version: 7,
      },
    );
    const source = adapter(
      "companies_house",
      ok([record("A", { name: "Acme", ethnicity: "redacted-me" })]),
    );

    await runIngestion([source], undefined, store);

    assert.equal(written.length, 1);
    assert.deepEqual(written[0].raw_payload, { name: "Acme" });
    assert.deepEqual(written[0].excluded_fields, ["ethnicity"]);
    assert.equal(written[0].rule_version_applied, 7);
  });
});
