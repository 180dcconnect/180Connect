import assert from "node:assert/strict";
import test from "node:test";

import {
  MIN_SENDS_FOR_TONE_RATE,
  describeToneRow,
  tonePerformanceSummary,
  type ToneRegisterRow,
  type ToneReplyRow,
  type ToneLengthRow,
  type ToneStatusRow,
} from "./tone-performance.ts";

// Fixtures speak ids: "m<n>" messages, "o<n>" orgs.
const reg = (id: string, orgId: string, value: string | null): ToneRegisterRow => ({
  id,
  organisation_id: orgId,
  tone_register: value,
});
const len = (id: string, orgId: string, value: string | null): ToneLengthRow => ({
  id,
  organisation_id: orgId,
  tone_length: value,
});
const reply = (messageId: string | null): ToneReplyRow => ({ outreach_message_id: messageId });
const status = (messageId: string, orgId: string, outreachStatus: string): ToneStatusRow => ({
  message_id: messageId,
  organisation_id: orgId,
  outreach_status: outreachStatus,
});

test("AC1: emails group by register, and a replied email lifts exactly that row", () => {
  const rows = [
    reg("m1", "o1", "warm"),
    reg("m2", "o2", "warm"),
    reg("m3", "o3", "formal"),
    reg("m4", "o4", "professional"),
  ];
  const replies = [reply("m1")];

  const summary = tonePerformanceSummary(rows, [], replies, []);

  const warm = summary.register.find((r) => r.value === "warm");
  const formal = summary.register.find((r) => r.value === "formal");
  const professional = summary.register.find((r) => r.value === "professional");
  assert.ok(warm && formal && professional);
  assert.equal(warm.sent, 2);
  assert.equal(warm.responses, 1);
  assert.equal(warm.responseRate, 0.5);
  assert.equal(formal.sent, 1);
  assert.equal(formal.responses, 0);
  assert.equal(formal.responseRate, 0);
  assert.equal(professional.sent, 1);
  // Every known enum value appears even with zero sends — a tone nobody has
  // used is a row, not an omission.
  assert.equal(summary.register.length, 4);
});

test("AC1: conversion attribution — a converted client counts on every tone-recorded email they received", () => {
  const rows = [
    reg("m1", "o1", "warm"),
    reg("m2", "o1", "warm"),
    reg("m3", "o2", "direct"),
    reg("m4", "o3", "direct"),
  ];
  const statuses = [
    status("m1", "o1", "converted"),
    status("m2", "o1", "initial_outreach_sent"),
    status("m3", "o2", "converted"),
    // o3 never converted.
    status("m4", "o3", "no_response"),
  ];

  const summary = tonePerformanceSummary(rows, [], [], statuses);

  const warm = summary.register.find((r) => r.value === "warm");
  const direct = summary.register.find((r) => r.value === "direct");
  assert.ok(warm && direct);
  // o1 converted: both of its warm emails attribute the conversion, but the
  // client is counted once per row.
  assert.equal(warm.conversions, 1);
  assert.equal(warm.conversionRate, 1 / 2);
  assert.equal(direct.conversions, 1);
  assert.equal(direct.conversionRate, 1 / 2);
});

test("AC3: rows with no recorded tone are excluded from every bucket and counted separately", () => {
  const rows = [
    reg("m1", "o1", "warm"),
    reg("m2", "o2", null),
    reg("m3", "o3", null),
  ];
  const replies = [reply("m2")];

  const summary = tonePerformanceSummary(rows, [], replies, []);

  const warm = summary.register.find((r) => r.value === "warm");
  assert.ok(warm);
  // The reply to the untracked email must not leak into any tone bucket.
  assert.equal(warm.responses, 0);
  assert.equal(warm.sent, 1);
  assert.equal(summary.untrackedRegister, 2);
  assert.equal(summary.untrackedLength, 0);
});

test("AC3: untracked emails appear under a known value in the other dial's own count", () => {
  // One email with a length but no register — its register row is untracked,
  // its length row is not.
  const summary = tonePerformanceSummary(
    [reg("m1", "o1", null)],
    [len("m1", "o1", "short")],
    [],
    [],
  );
  assert.equal(summary.untrackedRegister, 1);
  assert.equal(summary.untrackedLength, 0);
  const short = summary.length.find((r) => r.value === "short");
  assert.ok(short);
  assert.equal(short.sent, 1);
});

test("AC2: a tone below the threshold is still shown, flagged, and describes itself", () => {
  const rows = [
    reg("m1", "o1", "warm"),
    reg("m2", "o2", "warm"),
    reg("m3", "o3", "warm"),
    reg("m4", "o4", "warm"),
    reg("m5", "o5", "warm"),
    reg("m6", "o6", "formal"),
  ];

  const summary = tonePerformanceSummary(rows, [], [], []);
  const warm = summary.register.find((r) => r.value === "warm");
  const formal = summary.register.find((r) => r.value === "formal");
  assert.ok(warm && formal);
  assert.equal(warm.hasEnoughData, true);
  assert.equal(formal.sent, 1);
  assert.equal(formal.hasEnoughData, false);
  assert.equal(formal.threshold, MIN_SENDS_FOR_TONE_RATE);
  assert.match(describeToneRow(formal), /Too few emails/);
  assert.match(describeToneRow(formal), /1 of 5 needed/);
});

test("a tone never used says so instead of showing 0%", () => {
  const rows = [reg("m1", "o1", "warm")];
  const summary = tonePerformanceSummary(rows, [], [], []);
  const direct = summary.register.find((r) => r.value === "direct");
  assert.ok(direct);
  assert.equal(direct.sent, 0);
  assert.equal(direct.responseRate, null);
  assert.equal(direct.conversionRate, null);
  assert.equal(describeToneRow(direct), "Never used yet.");
});

test("multiple replies to one email count once as a response", () => {
  const rows = [reg("m1", "o1", "warm"), reg("m2", "o2", "warm")];
  const replies = [reply("m1"), reply("m1"), reply("m1")];

  const summary = tonePerformanceSummary(rows, [], replies, []);
  const warm = summary.register.find((r) => r.value === "warm");
  assert.ok(warm);
  assert.equal(warm.responses, 1);
  assert.equal(warm.responseRate, 0.5);
});

test("replies to unknown or unlinked messages never inflate a bucket", () => {
  const rows = [reg("m1", "o1", "warm")];
  const replies = [reply(null), reply("m-deleted"), reply("m1")];

  const summary = tonePerformanceSummary(rows, [], replies, []);
  const warm = summary.register.find((r) => r.value === "warm");
  assert.ok(warm);
  assert.equal(warm.responses, 1);
});

test("length groups independently of register", () => {
  const rows = [
    reg("m1", "o1", "warm"),
    reg("m2", "o2", "warm"),
    reg("m3", "o3", "warm"),
  ];
  const lengths = [len("m1", "o1", "short"), len("m2", "o2", "detailed"), len("m3", "o3", "short")];
  const replies = [reply("m2")];

  const summary = tonePerformanceSummary(rows, lengths, replies, []);
  const short = summary.length.find((r) => r.value === "short");
  const detailed = summary.length.find((r) => r.value === "detailed");
  assert.ok(short && detailed);
  assert.equal(short.sent, 2);
  assert.equal(short.responses, 0);
  assert.equal(detailed.sent, 1);
  assert.equal(detailed.responses, 1);
  // The register view is untouched by the length split.
  assert.equal(summary.register.find((r) => r.value === "warm")?.sent, 3);
});

test("non-converted statuses never count as conversions", () => {
  const rows = [reg("m1", "o1", "warm")];
  const statuses = [
    status("m1", "o1", "responded"),
    status("m1", "o1", "soft_no"),
    status("m1", "o1", "not_contacted"),
  ];

  const summary = tonePerformanceSummary(rows, [], [], statuses);
  const warm = summary.register.find((r) => r.value === "warm");
  assert.ok(warm);
  assert.equal(warm.conversions, 0);
  assert.equal(warm.conversionRate, 0);
});

test("an unknown stored value still appears rather than vanishing", () => {
  const rows = [reg("m1", "o1", "whimsical")];
  const summary = tonePerformanceSummary(rows, [], [], []);
  const whimsical = summary.register.find((r) => r.value === "whimsical");
  assert.ok(whimsical);
  assert.equal(whimsical.sent, 1);
  assert.equal(whimsical.label, "whimsical");
  assert.equal(whimsical.hasEnoughData, false);
});

test("an unknown stored value keeps its responses and conversions", () => {
  // A legacy enum value must read like any other tone: its real results were
  // once zeroed here, which made them vanish from the row emails display under.
  const rows = [
    reg("m1", "o1", "whimsical"),
    reg("m2", "o2", "whimsical"),
  ];
  const replies = [reply("m1"), reply("m1")]; // two replies, one responding email
  const statuses = [status("m1", "o1", "converted"), status("m2", "o2", "no_response")];

  const summary = tonePerformanceSummary(rows, [], replies, statuses);
  const whimsical = summary.register.find((r) => r.value === "whimsical");
  assert.ok(whimsical);
  assert.equal(whimsical.sent, 2);
  assert.equal(whimsical.responses, 1);
  assert.equal(whimsical.responseRate, 0.5);
  assert.equal(whimsical.conversions, 1);
  assert.equal(whimsical.conversionRate, 0.5);
});

test("empty inputs produce every row with zeros and no rates", () => {
  const summary = tonePerformanceSummary([], [], [], []);
  assert.equal(summary.register.length, 4);
  assert.equal(summary.length.length, 3);
  assert.ok(summary.register.every((r) => r.sent === 0 && r.responseRate === null));
  assert.ok(summary.length.every((r) => r.sent === 0 && r.conversionRate === null));
  assert.equal(summary.untrackedRegister, 0);
  assert.equal(summary.untrackedLength, 0);
  assert.equal(describeToneRow(summary.register[0]), "Never used yet.");
});
