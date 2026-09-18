import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  PROVIDER_STATUS_LINKS,
  SCHEDULED_JOB_NAMES,
  SCHEDULED_TASKS,
  scheduledTaskRow,
  summariseSystemHealth,
  type CronJobRow,
  type ScheduledTask,
  type SystemHealthInput,
} from "./system-health.ts";

const NOW = new Date("2026-09-15T12:00:00.000Z");

const minutesAgo = (minutes: number) =>
  new Date(NOW.getTime() - minutes * 60 * 1000).toISOString();

function taskFor(key: string): ScheduledTask {
  const task = SCHEDULED_TASKS.find((candidate) => candidate.key === key);
  assert.ok(task, `no scheduled task ${key}`);
  return task;
}

function job(overrides: Partial<CronJobRow> = {}): CronJobRow {
  return {
    job_name: "gmail_reply_sync",
    last_run_at: minutesAgo(3),
    last_run_succeeded: true,
    ...overrides,
  };
}

function input(overrides: Partial<SystemHealthInput> = {}): SystemHealthInput {
  return {
    now: NOW,
    keys: { ai: true, companiesHouse: true, charityCommission: true },
    gmail: { status: "active", detail: "Mailbox connected via Gmail API." },
    lastDraft: { ok: true, at: minutesAgo(60) },
    lastBooklet: { ok: true, at: null },
    lastScored: { ok: true, at: minutesAgo(5) },
    cronJobs: SCHEDULED_JOB_NAMES.map((name) => job({ job_name: name, last_run_at: minutesAgo(1) })),
    ...overrides,
  };
}

describe("scheduledTaskRow", () => {
  const replySync = taskFor("reply-sync");

  it("reports a recent successful run as working", () => {
    const row = scheduledTaskRow(replySync, [job()], NOW);
    assert.equal(row.tone, "ok");
    assert.match(row.note, /^Ran /);
  });

  it("flags a failed last run", () => {
    const row = scheduledTaskRow(replySync, [job({ last_run_succeeded: false })], NOW);
    assert.equal(row.tone, "attention");
    assert.match(row.note, /^Last run failed /);
  });

  it("flags a job that missed two runs while the rest of the schedule kept running", () => {
    const row = scheduledTaskRow(
      replySync,
      [
        job({ last_run_at: minutesAgo(30) }),
        job({ job_name: "scheduled_outreach_delivery", last_run_at: minutesAgo(1) }),
      ],
      NOW,
    );
    assert.equal(row.tone, "attention");
    assert.match(row.note, /^Has not run since /);
  });

  it("does not cry wolf at a job one slow tick behind", () => {
    const row = scheduledTaskRow(replySync, [job({ last_run_at: minutesAgo(15) })], NOW);
    assert.equal(row.tone, "ok");
  });

  it("does not cry wolf when the whole schedule woke up together", () => {
    // The shape of a dormant free-plan database: nothing has ticked for hours
    // because nothing could, and the overdue runs happen seconds after the page
    // load that woke it. Age alone is not a break — the row still says how long
    // ago it ran, so the reading is kept and the alarm withheld.
    const staleAt = minutesAgo(8 * 60);
    const row = scheduledTaskRow(
      replySync,
      [
        job({ last_run_at: staleAt }),
        job({ job_name: "scheduled_outreach_delivery", last_run_at: staleAt }),
      ],
      NOW,
    );
    assert.equal(row.tone, "ok");
    assert.match(row.note, /^Ran /);
  });

  it("stays quiet when there is no other job to compare against", () => {
    // Nothing proves the platform was awake, and an unproven alarm is what this
    // whole rule exists to avoid.
    const row = scheduledTaskRow(replySync, [job({ last_run_at: minutesAgo(120) })], NOW);
    assert.equal(row.tone, "ok");
  });

  it("still flags a failed run when nothing else has ticked", () => {
    // Direct evidence, not inference: a run that reported a failure is worth a
    // person's attention whatever the rest of the schedule is doing.
    const row = scheduledTaskRow(
      replySync,
      [job({ last_run_at: minutesAgo(8 * 60), last_run_succeeded: false })],
      NOW,
    );
    assert.equal(row.tone, "attention");
    assert.match(row.note, /^Last run failed /);
  });

  it("stays quiet about a job this environment does not schedule", () => {
    const row = scheduledTaskRow(replySync, [], NOW);
    assert.equal(row.tone, "idle");
    assert.equal(row.note, "Not scheduled here");
  });

  it("says when a scheduled job that has not run yet should tick", () => {
    const row = scheduledTaskRow(replySync, [job({ last_run_at: null, last_run_succeeded: null })], NOW);
    assert.equal(row.tone, "idle");
    assert.equal(row.note, "Waiting for its first run — runs every 5 minutes");
  });

  it("names a daily cadence in plain words", () => {
    const row = scheduledTaskRow(
      taskFor("follow-up-checks"),
      [
        job({ job_name: "stall_detection_daily", last_run_at: null, last_run_succeeded: null }),
        job({ job_name: "no_response_sweep_daily", last_run_at: null, last_run_succeeded: null }),
      ],
      NOW,
    );
    assert.equal(row.note, "Waiting for its first run — runs every day");
  });

  it("lets the worst job decide a task backed by two", () => {
    const row = scheduledTaskRow(
      taskFor("follow-up-checks"),
      [
        job({ job_name: "stall_detection_daily", last_run_at: minutesAgo(60) }),
        job({ job_name: "no_response_sweep_daily", last_run_at: minutesAgo(60), last_run_succeeded: false }),
      ],
      NOW,
    );
    assert.equal(row.tone, "attention");
  });
});

describe("summariseSystemHealth", () => {
  it("has nothing to raise when everything is proven", () => {
    const summary = summariseSystemHealth(input());
    assert.deepEqual(summary.attention, []);
    const services = summary.groups.find((group) => group.title === "Connected services")?.rows ?? [];
    // Every connected service says the same word, so the list reads as one
    // statement. Only Gmail's is a live round trip; the rest are their key.
    for (const key of ["gmail", "gemini", "companies-house", "charity-commission"]) {
      assert.equal(services.find((row) => row.key === key)?.note, "Connected");
    }
  });

  it("raises a Gmail connection that needs re-authorising", () => {
    const summary = summariseSystemHealth(
      input({ gmail: { status: "reauth-required", detail: "The Gmail connection needs to be re-authorised." } }),
    );
    assert.equal(summary.attention.length, 1);
    assert.equal(summary.attention[0].label, "Gmail");
    assert.equal(summary.attention[0].group, "Connected services");
  });

  it("treats a missing key as not connected rather than broken", () => {
    const summary = summariseSystemHealth(
      input({ keys: { ai: false, companiesHouse: false, charityCommission: false }, gmail: { status: "unconfigured", detail: "" } }),
    );
    assert.deepEqual(summary.attention, []);
    const drafting = summary.groups[0].rows?.find((row) => row.key === "drafting");
    assert.equal(drafting?.note, "Not connected");
    const services =
      summary.groups.find((group) => group.title === "Connected services")?.rows ?? [];
    for (const key of ["gmail", "gemini", "companies-house", "charity-commission"]) {
      assert.equal(services.find((row) => row.key === key)?.note, "Not connected");
    }
  });

  it("never lists something that is not built yet", () => {
    const rows = summariseSystemHealth(input()).groups.flatMap((group) => group.rows ?? []);
    assert.equal(
      rows.some((row) => row.note === "Not built yet"),
      false,
    );
  });

  it("says the schedule could not be read instead of inventing rows", () => {
    const summary = summariseSystemHealth(input({ cronJobs: null }));
    const scheduled = summary.groups.find((group) => group.title === "Scheduled jobs");
    assert.equal(scheduled?.rows, null);
    assert.ok(scheduled?.unavailable);
    assert.deepEqual(summary.attention, []);
  });

  it("says when an AI feature last worked, or that it has not been used", () => {
    const summary = summariseSystemHealth(input());
    const rows = summary.groups[0].rows ?? [];
    assert.match(rows.find((row) => row.key === "drafting")?.note ?? "", /^Last draft /);
    assert.equal(rows.find((row) => row.key === "booklets")?.note, "No booklets yet");
  });

  it("does not list register discovery, which was retired", () => {
    // Both jobs were unscheduled when the register files replaced API discovery
    // (20260923120000, 20260923132000). A row for them could only ever read "Not
    // scheduled here" on every environment, so the task is gone and the card
    // does not even ask about the job names.
    const scheduled = summariseSystemHealth(input()).groups.find(
      (group) => group.title === "Scheduled jobs",
    );
    assert.ok(scheduled?.rows);
    assert.equal(
      scheduled.rows.some((row) => row.key === "discovery"),
      false,
    );
    for (const retired of [
      "charity_commission_discovery_weekly",
      "companies_house_discovery_weekly",
    ]) {
      assert.equal(SCHEDULED_JOB_NAMES.includes(retired), false);
    }
  });
});

describe("PROVIDER_STATUS_LINKS", () => {
  it("links the three providers over https with unique keys", () => {
    assert.equal(PROVIDER_STATUS_LINKS.length, 3);
    const keys = PROVIDER_STATUS_LINKS.map((link) => link.key);
    assert.equal(new Set(keys).size, keys.length);
    for (const link of PROVIDER_STATUS_LINKS) {
      assert.ok(link.label.trim().length > 0);
      assert.match(link.href, /^https:\/\//);
    }
  });

  it("stays out of the attention list — links never raise", () => {
    const summary = summariseSystemHealth(input());
    for (const link of PROVIDER_STATUS_LINKS) {
      assert.equal(
        summary.attention.some((row) => row.key === link.key),
        false,
      );
    }
  });
});
