import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PerformanceSummary, PersonWeekly, TeamUserRow } from "../performance-metrics.ts";
import { MIN_SAMPLE_EMAILS, camLeaderboard } from "./cam-leaderboard.ts";

function person(
  userId: string,
  emailsSent: number,
  replies: number,
  conversions: number,
): PersonWeekly {
  return {
    userId,
    name: userId,
    emailsSent: { thisWeek: emailsSent, lastWeek: 0 },
    replies: { thisWeek: replies, lastWeek: 0 },
    conversions: { thisWeek: conversions, lastWeek: 0 },
  };
}

function summaryOf(people: PersonWeekly[]): PerformanceSummary {
  const team = {
    emailsSent: { thisWeek: 0, lastWeek: 0 },
    replies: { thisWeek: 0, lastWeek: 0 },
    conversions: { thisWeek: 0, lastWeek: 0 },
  };
  for (const entry of people) {
    team.emailsSent.thisWeek += entry.emailsSent.thisWeek;
    team.replies.thisWeek += entry.replies.thisWeek;
    team.conversions.thisWeek += entry.conversions.thisWeek;
  }
  return {
    team,
    people: new Map(people.map((entry) => [entry.userId, entry])),
    orgsScored: { thisWeek: 0, lastWeek: 0 },
  };
}

const cam = (id: string, name: string | null = id): TeamUserRow => ({
  id,
  full_name: name,
  role: "cam",
});

describe("camLeaderboard", () => {
  it("returns a row for every CAM, including ones with no activity", () => {
    const board = camLeaderboard(summaryOf([person("a", 20, 5, 2)]), [cam("a"), cam("b")]);
    assert.equal(board.rows.length, 2);
    const b = board.rows.find((row) => row.userId === "b")!;
    assert.equal(b.emailsSent, 0);
    assert.equal(b.replyRate, null);
    assert.equal(b.inactive, true);
    assert.equal(board.inactiveCount, 1);
  });

  it("names an unnamed CAM rather than rendering a blank row", () => {
    const board = camLeaderboard(summaryOf([]), [cam("a", null), cam("b", "   ")]);
    assert.deepEqual(
      board.rows.map((row) => row.name),
      ["Unnamed CAM", "Unnamed CAM"],
    );
  });

  it("computes rates off emails sent", () => {
    const board = camLeaderboard(summaryOf([person("a", 20, 5, 2)]), [cam("a")]);
    assert.equal(board.rows[0].replyRate, 0.25);
    assert.equal(board.rows[0].conversionRate, 0.1);
  });

  it("marks a CAM under the sample floor as low confidence, not as needing support", () => {
    const board = camLeaderboard(
      summaryOf([person("a", MIN_SAMPLE_EMAILS - 1, 0, 0), person("b", 40, 20, 5)]),
      [cam("a"), cam("b")],
    );
    const a = board.rows.find((row) => row.userId === "a")!;
    assert.equal(a.lowConfidence, true);
    assert.equal(a.needsSupport, false);
    assert.equal(a.inactive, false);
  });

  it("flags a well-sampled CAM well below the team median reply rate", () => {
    // Median across sampled CAMs is 0.5; 0.05 is under 0.6 x 0.5 = 0.30.
    const board = camLeaderboard(
      summaryOf([person("a", 40, 2, 0), person("b", 40, 20, 4), person("c", 40, 20, 6)]),
      [cam("a"), cam("b"), cam("c")],
    );
    assert.equal(board.medianReplyRate, 0.5);
    assert.equal(board.rows.find((row) => row.userId === "a")!.needsSupport, true);
    assert.equal(board.rows.find((row) => row.userId === "b")!.needsSupport, false);
    assert.equal(board.needsSupportCount, 1);
  });

  it("does not flag a CAM merely below the median", () => {
    // Median 0.5; 0.4 is above 0.6 x 0.5, so this is variance, not a problem.
    const board = camLeaderboard(
      summaryOf([person("a", 40, 16, 3), person("b", 40, 20, 4), person("c", 40, 20, 5)]),
      [cam("a"), cam("b"), cam("c")],
    );
    assert.equal(board.needsSupportCount, 0);
  });

  it("flags nobody when the team median reply rate is zero", () => {
    const board = camLeaderboard(
      summaryOf([person("a", 40, 0, 0), person("b", 40, 0, 0)]),
      [cam("a"), cam("b")],
    );
    assert.equal(board.medianReplyRate, 0);
    assert.equal(board.needsSupportCount, 0);
  });

  it("reports a null median when no CAM clears the sample floor", () => {
    const board = camLeaderboard(summaryOf([person("a", 3, 1, 0)]), [cam("a")]);
    assert.equal(board.medianReplyRate, null);
    assert.equal(board.needsSupportCount, 0);
  });

  it("averages the two middle rates for an even number of sampled CAMs", () => {
    const board = camLeaderboard(
      summaryOf([
        person("a", 40, 4, 0),
        person("b", 40, 8, 0),
        person("c", 40, 16, 0),
        person("d", 40, 20, 0),
      ]),
      [cam("a"), cam("b"), cam("c"), cam("d")],
    );
    // 0.1, 0.2, 0.4, 0.5 -> (0.2 + 0.4) / 2
    assert.ok(Math.abs((board.medianReplyRate ?? 0) - 0.3) < 1e-9);
  });

  it("computes the team reply rate from team totals, not an average of rates", () => {
    const board = camLeaderboard(
      summaryOf([person("a", 90, 0, 0), person("b", 10, 10, 0)]),
      [cam("a"), cam("b")],
    );
    assert.equal(board.teamReplyRate, 0.1);
  });

  it("sorts by conversions, then replies, then sent, then name", () => {
    const board = camLeaderboard(
      summaryOf([person("a", 10, 1, 1), person("b", 10, 5, 3), person("c", 50, 5, 1)]),
      [cam("a"), cam("b"), cam("c")],
    );
    assert.deepEqual(
      board.rows.map((row) => row.userId),
      ["b", "c", "a"],
    );
  });

  it("does not sort struggling CAMs to the top", () => {
    const board = camLeaderboard(
      summaryOf([person("a", 40, 2, 0), person("b", 40, 20, 4), person("c", 40, 20, 6)]),
      [cam("a"), cam("b"), cam("c")],
    );
    assert.equal(board.rows[0].userId, "c");
    assert.equal(board.rows.at(-1)!.userId, "a");
  });

  it("degrades to an empty board with no CAMs", () => {
    const board = camLeaderboard(summaryOf([]), []);
    assert.deepEqual(board.rows, []);
    assert.equal(board.teamReplyRate, null);
    assert.equal(board.medianReplyRate, null);
  });
});
