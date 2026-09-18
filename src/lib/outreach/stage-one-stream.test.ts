import assert from "node:assert/strict";
import test from "node:test";
import { createStageOneModelCall, STAGE_ONE_MODEL_OPTIONS } from "./stage-one-generation.ts";
import { createStageOneStreamCall, streamStageOneDraft, stripSubjectEcho, type StageOneStreamEvent } from "./stage-one-stream.ts";

const context = { organisationName: "Example Charity", organisationType: "charity" };
const USAGE = { inputTokens: 120, outputTokens: 45, totalTokens: 165 };

/** A fake model: yields the given partials, then resolves the final draft. */
function fakeStreamModel(
  partials: Array<{ subject?: string; body?: string }>,
  final = { subject: "Working together", body: "Hello, we would like to introduce 180DC." },
) {
  return () => ({
    partials: (async function* () {
      for (const partial of partials) yield partial;
    })(),
    final: Promise.resolve({ draft: final, usage: USAGE }),
  });
}

test("streamStageOneDraft forwards body deltas and resolves the final draft", async () => {
  const events: StageOneStreamEvent[] = [];
  const result = await streamStageOneDraft(
    "org-1",
    context,
    fakeStreamModel([{ subject: "Working" }, { subject: "Working together", body: "Hello," }, { subject: "Working together", body: "Hello, we would like to introduce 180DC." }]),
    (event) => events.push(event),
  );

  assert.deepEqual(
    events.filter((event) => event.type === "delta"),
    [{ type: "delta", text: "Hello," }, { type: "delta", text: " we would like to introduce 180DC." }],
  );
  assert.ok(events.some((event) => event.type === "stage" && event.stage === "reading"));
  assert.ok(events.some((event) => event.type === "stage" && event.stage === "drafting"));
  assert.ok(events.some((event) => event.type === "stage" && event.stage === "saving"));
  assert.ok(events.some((event) => event.type === "subject" && event.subject === "Working together"));
  assert.deepEqual((result as { draft: unknown }).draft, {
    subject: "Working together",
    body: "Hello, we would like to introduce 180DC.",
  });
  assert.equal((result as { sizeTemplate: unknown }).sizeTemplate, "default");
});

test("streamStageOneDraft turns model failure into retryable user copy", async () => {
  const result = await streamStageOneDraft(
    "org-1",
    context,
    () => {
      throw new Error("secret upstream detail");
    },
    () => {},
  );
  assert.deepEqual(result, { error: "The email draft could not be generated. Try again." });
});

test("streamStageOneDraft rejects an incomplete final draft", async () => {
  const result = await streamStageOneDraft(
    "org-1",
    context,
    fakeStreamModel([], { subject: "Working together", body: "   " }),
    () => {},
  );
  assert.deepEqual(result, { error: "The email draft could not be generated. Try again." });
});

test("streamStageOneDraft falls back to one-shot when the stream is unparseable", async () => {
  const events: StageOneStreamEvent[] = [];
  const fallback = async () => ({
    text: JSON.stringify({ subject: "Fallback subject", body: "Fallback body." }),
    usage: USAGE,
  });
  const result = await streamStageOneDraft(
    "org-1",
    context,
    () => {
      throw new Error("AI_NoObjectGeneratedError: No object generated");
    },
    (event) => events.push(event),
    {},
    fallback,
  );

  assert.ok(events.some((event) => event.type === "restart"), "expected a restart event");
  assert.deepEqual(
    events.filter((event) => event.type === "delta"),
    [{ type: "delta", text: "Fallback body." }],
  );
  assert.deepEqual((result as { draft: unknown }).draft, {
    subject: "Fallback subject",
    body: "Fallback body.",
  });
});

test("streamStageOneDraft reports failure when the fallback also fails", async () => {
  const result = await streamStageOneDraft(
    "org-1",
    context,
    () => {
      throw new Error("AI_NoObjectGeneratedError: No object generated");
    },
    () => {},
    {},
    async () => {
      throw new Error("boom");
    },
  );
  assert.deepEqual(result, { error: "The email draft could not be generated. Try again." });
});

test("streamStageOneDraft retries a truncated fallback response once", async () => {  const events: StageOneStreamEvent[] = [];
  let calls = 0;
  const flakyFallback = async () => {
    calls++;
    if (calls === 1) {
      // The real failure: the model stops mid-string, far under any limit.
      return { text: '{"subject": "Half a thought", "body": "Dear Fri', usage: USAGE };
    }
    return {
      text: JSON.stringify({ subject: "Retry subject", body: "Retry body." }),
      usage: USAGE,
    };
  };
  const result = await streamStageOneDraft(
    "org-1",
    context,
    () => {
      throw new Error("AI_NoObjectGeneratedError: No object generated");
    },
    (event) => events.push(event),
    {},
    flakyFallback,
  );

  assert.equal(calls, 2);
  assert.equal(events.filter((event) => event.type === "restart").length, 1);
  assert.deepEqual((result as { draft: unknown }).draft, {
    subject: "Retry subject",
    body: "Retry body.",
  });
});

test("both call shapes share one token budget with minimal thinking", () => {
  // Regression lock for the mid-word truncations: thinking tokens count
  // against maxOutputTokens, so the budget and thinking level must never
  // drift apart between the one-shot and streaming paths.
  const previousKey = process.env.GEMINI_API_KEY;
  const previousModel = process.env.GEMINI_MODEL;
  process.env.GEMINI_API_KEY = "test-key";
  process.env.GEMINI_MODEL = "test-model";
  try {
    const oneShot = createStageOneModelCall();
    assert.equal(typeof oneShot.callModel, "function");
    const stream = createStageOneStreamCall();
    assert.equal(typeof stream.streamModel, "function");
    assert.equal(typeof stream.callModel, "function");
    assert.equal(stream.model, "test-model");
  } finally {
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousKey;
    if (previousModel === undefined) delete process.env.GEMINI_MODEL;
    else process.env.GEMINI_MODEL = previousModel;
  }
  assert.equal(STAGE_ONE_MODEL_OPTIONS.maxOutputTokens, 4096);
  assert.equal(
    STAGE_ONE_MODEL_OPTIONS.providerOptions.google.thinkingConfig.thinkingLevel,
    "minimal",
  );
});

test("stripSubjectEcho drops a body that opens by restating the subject", () => {
  assert.equal(
    stripSubjectEcho("Working together", "Working together\n\nDear Friend,\nHello."),
    "Dear Friend,\nHello.",
  );
  assert.equal(
    stripSubjectEcho("Working together", "Subject: Working together!\n\nDear Friend,"),
    "Dear Friend,",
  );
  assert.equal(
    stripSubjectEcho("Working together", "Working on something new\n\nDear Friend,"),
    "Working on something new\n\nDear Friend,",
  );
  assert.equal(stripSubjectEcho("Working together", "Dear Friend,"), "Dear Friend,");
});
