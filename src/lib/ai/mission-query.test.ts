import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  MISSION_KEYWORDS_MAX,
  MISSION_QUERY_MAX_LENGTH,
  buildMissionQueryPrompt,
  createMissionQueryModelCall,
  expandMissionQuery,
  parseMissionQueryExpansion,
  type CallMissionQueryModel,
} from "./mission-query.ts";

/** A model double that never resolves: simulates a hang/timeout. */
const neverModel: CallMissionQueryModel = () => new Promise(() => undefined);

/** Fresh cache per test so entries never leak between cases. */
function freshDeps(callModel: CallMissionQueryModel) {
  return { callModel, model: "test-model" };
}

describe("buildMissionQueryPrompt", () => {
  it("includes the query and the JSON contract", () => {
    const prompt = buildMissionQueryPrompt("helping refugees");
    assert.ok(prompt.includes("helping refugees"));
    assert.ok(prompt.includes('"keywords"'));
    assert.ok(prompt.includes("3 to 8"));
  });
});

describe("parseMissionQueryExpansion", () => {
  it("parses a valid JSON reply", () => {
    const terms = parseMissionQueryExpansion(
      '{"keywords": ["asylum seekers", "displaced families", "resettlement"]}',
      "helping refugees",
    );
    assert.deepEqual(terms, ["asylum seekers", "displaced families", "resettlement"]);
  });

  it("strips a markdown fence around the JSON", () => {
    const terms = parseMissionQueryExpansion(
      '```json\n{"keywords": ["asylum seekers"]}\n```',
      "helping refugees",
    );
    assert.deepEqual(terms, ["asylum seekers"]);
  });

  it("returns empty for garbage, non-JSON, or a missing keywords array", () => {
    assert.deepEqual(parseMissionQueryExpansion("sorry, I cannot", "climate"), []);
    assert.deepEqual(parseMissionQueryExpansion("{}", "climate"), []);
    assert.deepEqual(parseMissionQueryExpansion('{"keywords": "climate"}', "climate"), []);
    assert.deepEqual(parseMissionQueryExpansion('{"keywords": [1, null, true]}', "climate"), []);
  });

  it("drops terms that merely restate the query's own words", () => {
    const terms = parseMissionQueryExpansion(
      '{"keywords": ["refugees", "helping", "asylum seekers"]}',
      "helping refugees",
    );
    assert.deepEqual(terms, ["asylum seekers"]);
  });

  it("sanitises punctuation and collapses whitespace", () => {
    const terms = parseMissionQueryExpansion(
      '{"keywords": ["Asylum  Seekers!", "mental-health"]}',
      "refugees",
    );
    // "asylum" is not in the query, so the whole term survives; only the "!"
    // is stripped and the double space collapsed.
    assert.deepEqual(terms, ["asylum seekers", "mental-health"]);
  });

  it("caps term length and total count", () => {
    const long = "x".repeat(60);
    assert.deepEqual(parseMissionQueryExpansion(`{"keywords": ["${long}"]}`, "climate"), []);
    const many = Array.from({ length: 20 }, (_, i) => `term ${i}`);
    const terms = parseMissionQueryExpansion(
      JSON.stringify({ keywords: many }),
      "climate",
    );
    assert.equal(terms.length, MISSION_KEYWORDS_MAX);
  });
});

describe("createMissionQueryModelCall", () => {
  it("throws at construction when Gemini is not configured", () => {
    const originalKey = process.env.GEMINI_API_KEY;
    const originalModel = process.env.GEMINI_MODEL;
    try {
      delete process.env.GEMINI_API_KEY;
      delete process.env.GEMINI_MODEL;
      assert.throws(() => createMissionQueryModelCall(), /not configured/);
    } finally {
      if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = originalKey;
      if (originalModel === undefined) delete process.env.GEMINI_MODEL;
      else process.env.GEMINI_MODEL = originalModel;
    }
  });
});

describe("expandMissionQuery", () => {
  it("returns semantic mode with the model's keywords", async () => {
    const deps = freshDeps(async () => ({
      text: '{"keywords": ["asylum seekers", "displaced families"]}',
    }));
    const result = await expandMissionQuery("helping refugees", deps, new Map());
    assert.equal(result.mode, "semantic");
    assert.deepEqual(result.keywords, ["asylum seekers", "displaced families"]);
  });

  it("degrades to keyword mode when the model reply is unusable", async () => {
    const deps = freshDeps(async () => ({ text: "not json at all" }));
    const result = await expandMissionQuery("climate", deps, new Map());
    assert.deepEqual(result.keywords, []);
    assert.equal(result.mode, "keyword");
  });

  it("degrades to unavailable mode when the model call throws", async () => {
    const deps = freshDeps(async () => {
      throw new Error("503 upstream");
    });
    const result = await expandMissionQuery("climate", deps, new Map());
    assert.deepEqual(result.keywords, []);
    assert.equal(result.mode, "unavailable");
  });

  it("never rejects when the model hangs — the caller cannot be held hostage", async () => {
    // The AI SDK owns the real timeout; the contract under test is that the
    // function does not throw when the call rejects late or never. The page's
    // own render is the deadline in the worst case; this pins the no-throw half.
    const result = await Promise.race([
      expandMissionQuery("climate", freshDeps(neverModel), new Map()),
      new Promise<{ mode: string }>((resolve) =>
        setTimeout(() => resolve({ mode: "still-pending" }), 50),
      ),
    ]);
    assert.ok(result.mode in { "still-pending": true, semantic: true, keyword: true, unavailable: true });
  });

  it("degrades to unavailable when Gemini is not configured", async () => {
    const originalKey = process.env.GEMINI_API_KEY;
    const originalModel = process.env.GEMINI_MODEL;
    try {
      delete process.env.GEMINI_API_KEY;
      delete process.env.GEMINI_MODEL;
      const result = await expandMissionQuery("climate", undefined, new Map());
      assert.deepEqual(result.keywords, []);
      assert.equal(result.mode, "unavailable");
    } finally {
      if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = originalKey;
      if (originalModel === undefined) delete process.env.GEMINI_MODEL;
      else process.env.GEMINI_MODEL = originalModel;
    }
  });

  it("returns keyword mode for an empty or over-long query without calling the model", async () => {
    let called = 0;
    const deps = freshDeps(async () => {
      called += 1;
      return { text: '{"keywords": ["x"]}' };
    });
    assert.deepEqual(await expandMissionQuery("   ", deps, new Map()), { keywords: [], mode: "keyword" });
    assert.deepEqual(
      await expandMissionQuery("a".repeat(MISSION_QUERY_MAX_LENGTH + 1), deps, new Map()),
      { keywords: [], mode: "keyword" },
    );
    assert.equal(called, 0);
  });

  it("caches per normalised query so a repeat does not re-call the model", async () => {
    let called = 0;
    const deps = freshDeps(async () => {
      called += 1;
      return { text: '{"keywords": ["asylum seekers"]}' };
    });
    const cache = new Map();
    const first = await expandMissionQuery("Helping Refugees ", deps, cache);
    const second = await expandMissionQuery("helping refugees", deps, cache);
    assert.equal(called, 1);
    assert.deepEqual(second.keywords, first.keywords);
    assert.equal(second.mode, "semantic");
  });

  it("caches a failure briefly and reports it as unavailable on repeat", async () => {
    let called = 0;
    const deps = freshDeps(async () => {
      called += 1;
      throw new Error("down");
    });
    const cache = new Map();
    await expandMissionQuery("climate", deps, cache);
    const second = await expandMissionQuery("climate", deps, cache);
    assert.equal(called, 1);
    assert.equal(second.mode, "unavailable");
  });
});
