import assert from "node:assert/strict";
import test from "node:test";
import { buildStageOnePrompt } from "./stage-one-prompt.ts";
import { buildStageTwoPrompt, capReply, formatReplyDate, MAX_REPLY_CHARS } from "./stage-two-prompt.ts";

test("Stage 2 prompt requires an acknowledgement and includes Stage 1 and booklet context", () => {
  const result = buildStageTwoPrompt({
    organisationName: "Example Charity",
    organisationType: "charity",
    booklet: "Reviewed booklet insight",
    previousSubject: "Could we help?",
    previousBody: "Our original introduction",
  });
  assert.match(result.system, /acknowledge the previous email/i);
  assert.match(result.system, /do not write a fresh cold open/i);
  assert.match(result.prompt, /Reviewed booklet insight/);
  assert.match(result.prompt, /Our original introduction/);
});

test("Stage 2 prompt only exposes a live news hook when enabled", () => {
  const context = { organisationName: "Example", organisationType: "charity", newsHooks: ["New programme launched"] };
  assert.doesNotMatch(buildStageTwoPrompt(context).prompt, /New programme launched/);
  assert.match(buildStageTwoPrompt(context, { newsEnabled: true }).prompt, /New programme launched/);
});

test("reply follow-up uses the actual reply and asks the model to answer it", () => {
  const result = buildStageTwoPrompt({
    organisationName: "Example Charity",
    organisationType: "charity",
    previousSubject: "Consulting support",
    previousBody: "Could we arrange an introduction?",
    replyBody: "Thanks. What would a typical project cost us?",
  });

  assert.match(
    result.system,
    /This is a direct response to a client's reply\. Address what the client actually asked or said, and keep the response grounded in that reply\. Do not describe this as an unanswered follow-up and do not ignore a question in the reply\./,
  );
  assert.doesNotMatch(result.system, /initial email received no response/i);
  assert.match(result.prompt, /What would a typical project cost us\?/);
  assert.match(
    result.prompt,
    /Answer the client's reply directly\. If it contains a question, address it using only the supplied context; if the answer is not available, acknowledge the question and propose a sensible next step without inventing an answer\./,
  );
});

test("Stage 2 prompt includes extracted PDF context (F220)", () => {
  const result = buildStageTwoPrompt({
    organisationName: "Example",
    organisationType: "charity",
    attachmentText: "File: strategy.pdf\nPriority is volunteer retention.",
  });
  assert.match(result.prompt, /strategy\.pdf/);
  assert.match(result.prompt, /volunteer retention/);
});

// ---------------------------------------------------------------------------
// The contradiction that used to sit in the system prompt.
// ---------------------------------------------------------------------------

test("Stage 2 never claims this is a first contact, while Stage 1 still must", () => {
  const reply = buildStageTwoPrompt({
    organisationName: "Example Charity",
    organisationType: "charity",
    previousBody: "Our original introduction",
    replyBody: "Thanks for getting in touch.",
  });
  // "this is the first time we have written to them" is false in a reply, and
  // it used to arrive in the same system prompt as the instruction to answer
  // the reply. Both rules were absolute, so the model resolved the clash
  // silently and differently each run.
  assert.doesNotMatch(reply.system, /first time we have written/i);
  assert.doesNotMatch(reply.system, /Do not imply an existing relationship/i);

  const coldOpen = buildStageOnePrompt({ organisationName: "Example Charity", organisationType: "charity" });
  assert.match(coldOpen.system, /first time we have written/i);
  // The rules that are true in both stages survive in both.
  for (const system of [reply.system, coldOpen.system]) {
    assert.match(system, /British English/);
    assert.match(system, /Never invent achievements/);
  }
});

// ---------------------------------------------------------------------------
// No subject. A reply goes out on the existing thread (see StageTwoDraft).
// ---------------------------------------------------------------------------

test("Stage 2 asks for a body only, and says why there is no subject", () => {
  const result = buildStageTwoPrompt({
    organisationName: "Example Charity",
    organisationType: "charity",
    replyBody: "Could you tell me more?",
  });

  assert.match(result.system, /Do not write a subject line\./);
  assert.match(result.system, /Return exactly one JSON object with one string property, "body"\. Do not include a "subject" property\./);
  // The Stage 1 subject rules are not inherited — they would spend instruction
  // budget on a value the send path discards.
  assert.doesNotMatch(result.system, /Subject: four to eight words/);
});

// ---------------------------------------------------------------------------
// The greeting follows whoever actually wrote in.
// ---------------------------------------------------------------------------

test("a reply greets the person who wrote it, not the primary contact", () => {
  const result = buildStageTwoPrompt({
    organisationName: "Example Charity",
    organisationType: "charity",
    contactName: "Primary Contact",
    replyAuthorName: "Ada Lovelace",
    previousBody: "Our original introduction",
    replyBody: "Happy to talk.",
  });

  assert.match(result.system, /address Ada Lovelace by first name only — "Dear Ada,"/);
  assert.doesNotMatch(result.system, /Dear Primary,/);
  assert.match(result.prompt, /The person who wrote in is Ada Lovelace\./);
});

test("an unrouted reply falls back to the team greeting rather than naming the primary contact", () => {
  const result = buildStageTwoPrompt({
    organisationName: "Example Charity",
    tradingName: "Example",
    organisationType: "charity",
    contactName: "Primary Contact",
    previousBody: "Our original introduction",
    replyBody: "Happy to talk.",
  });

  assert.doesNotMatch(result.system, /Primary Contact/);
  assert.match(result.system, /Open with "Dear Example team,"/);
  assert.match(result.prompt, /It is not recorded which individual wrote in/);
});

// ---------------------------------------------------------------------------
// The classification the pipeline already made. Passing it is the point: the
// model used to have to re-derive "declined" versus "interested" from prose.
// ---------------------------------------------------------------------------

test("the reply's sentiment and intent reach the prompt, not just its text", () => {
  const result = buildStageTwoPrompt({
    organisationName: "Example Charity",
    organisationType: "charity",
    previousBody: "Our original introduction",
    replyBody: "Send me some more detail and I'll pass it round.",
    replySentiment: "positive",
    replyIntent: "more_info",
  });

  assert.match(result.prompt, /read of the reply is positive in tone/);
  assert.match(result.prompt, /classified as wanting more information\./);
  assert.match(result.prompt, /Do not list our practice areas again/);
});

test("a decline overrides the closing dial, which has no shape for one", () => {
  const result = buildStageTwoPrompt(
    {
      organisationName: "Example Charity",
      organisationType: "charity",
      previousBody: "Our original introduction",
      replyBody: "Thanks, but we are not taking on support this year.",
      replySentiment: "negative",
      replyIntent: "not_interested",
    },
    // A CAM who left the picker on the default for a live reply.
    { closing: "answer_next_step" },
  );

  assert.match(result.system, /thank you for the introduction|thanking them for replying/i);
  assert.match(result.system, /Do not ask a question, do not propose a call or a next step/);
  assert.doesNotMatch(result.system, /Never ask whether support could be useful — they already replied\./);
  assert.match(result.prompt, /The client has declined\./);
});

test("a referral overrides the dial too, and asks before approaching anyone", () => {
  const result = buildStageTwoPrompt(
    {
      organisationName: "Example Charity",
      organisationType: "charity",
      previousBody: "Our original introduction",
      replyBody: "Not us — talk to the food bank on the high street.",
      replyIntent: "referral",
    },
    { closing: "short_call" },
  );

  assert.match(result.system, /asking, in one sentence, whether it is alright for us to get in touch/);
  assert.match(result.system, /Never state or imply that the new contact is expecting to hear from us/);
  assert.doesNotMatch(result.system, /Never call it introductory — this conversation already started\./);
  assert.match(result.prompt, /pointing us to somebody else\./);
});

test("an interested reply keeps the CAM's chosen closing", () => {
  const result = buildStageTwoPrompt(
    {
      organisationName: "Example Charity",
      organisationType: "charity",
      previousBody: "Our original introduction",
      replyBody: "Yes please — when could we speak?",
      replyIntent: "interested",
    },
    { closing: "short_call" },
  );

  assert.match(result.system, /Close by suggesting a short call to talk through what they raised/);
  assert.doesNotMatch(result.system, /thanking them for replying and saying plainly that it sounds like now is not the right time/);
  // A follow-up with no reply at all has no classification to apply.
  const nudge = buildStageTwoPrompt({ organisationName: "Example", organisationType: "charity" });
  assert.doesNotMatch(nudge.prompt, /read of the reply/);
});

// ---------------------------------------------------------------------------
// The reply is capped with its own marker, not the booklet's.
// ---------------------------------------------------------------------------

test("a truncated reply is labelled as a reply, not as a booklet", () => {
  const long = "word ".repeat(2_000);
  const result = buildStageTwoPrompt({
    organisationName: "Example",
    organisationType: "charity",
    previousBody: "Our original introduction",
    replyBody: long,
  });

  assert.match(result.prompt, /\[Reply truncated for length\.\]/);
  assert.doesNotMatch(result.prompt, /\[Booklet truncated for length\.\]/);
  assert.equal(capReply("x".repeat(5_000)).length, MAX_REPLY_CHARS + "\n[Reply truncated for length.]".length);
});

test("the reply date is given as a fact and never as something to restate", () => {
  const result = buildStageTwoPrompt({
    organisationName: "Example",
    organisationType: "charity",
    previousBody: "Our original introduction",
    replyBody: "Yes, let's talk.",
    replyReceivedAt: "2026-09-08T09:05:00.000Z",
  });

  assert.match(result.prompt, /Their reply arrived on 8 September 2026\./);
  assert.match(result.prompt, /Do not restate that date/);

  const undated = buildStageTwoPrompt({
    organisationName: "Example",
    organisationType: "charity",
    previousBody: "Our original introduction",
    replyBody: "Yes, let's talk.",
  });
  assert.doesNotMatch(undated.prompt, /Their reply arrived on/);
  assert.equal(formatReplyDate("not a date"), null);
  assert.equal(formatReplyDate(null), null);
});
