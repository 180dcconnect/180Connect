import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PerformanceSummary, PersonWeekly, TeamUserRow } from "../performance-metrics.ts";
import { outreachRates } from "../outreach-rates.ts";
import { MIN_SAMPLE_CONTACTS, camLeaderboard } from "./cam-leaderboard.ts";

/** `n` distinct client ids — the unit both rates are built from. */
const clients = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}-${i}`);

/**
 * A person with a real client funnel: rates are derived through the shared
 * `outreachRates` rather than typed in, so a test cannot assert a rate the
 * production code could not produce. `emailsSent` defaults to one per contacted
 * client; pass it explicitly where the two should differ.
 */
function person(
  userId: string,
  contacted: readonly string[],
  replied: readonly string[],
  converted: readonly string[],
  emailsSent = contacted.length,
): PersonWeekly {
  const rates = outreachRates({
    contacted: new Set(contacted),
    replied: new Set(replied),
    converted: new Set(converted),
  });
  return {
    userId,
    name: userId,
    emailsSent: { thisWeek: emailsSent, lastWeek: 0 },
    replies: { thisWeek: replied.length, lastWeek: 0 },
    conversions: { thisWeek: converted.length, lastWeek: 0 },
    ...rates,
  };
}

function summaryOf(
  people: PersonWeekly[],
  teamFunnel?: { contacted: readonly string[]; replied: readonly string[]; converted: readonly string[] },
): PerformanceSummary {
  const team = {
    emailsSent: { thisWeek: 0, lastWeek: 0 },
    replies: { thisWeek: 0, lastWeek: 0 },
    conversions: { thisWeek: 0, lastWeek: 0 },
    contactedClients: 0,
    repliedClients: 0,
    respondedClients: 0,
    convertedClients: 0,
    replyRate: null as number | null,
    winRate: null as number | null,
  };
  for (const entry of people) {
    team.emailsSent.thisWeek += entry.emailsSent.thisWeek;
    team.replies.thisWeek += entry.replies.thisWeek;
    team.conversions.thisWeek += entry.conversions.thisWeek;
  }
  if (teamFunnel) {
    Object.assign(
      team,
      outreachRates({
        contacted: new Set(teamFunnel.contacted),
        replied: new Set(teamFunnel.replied),
        converted: new Set(teamFunnel.converted),
      }),
    );
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
    const board = camLeaderboard(
      summaryOf([person("a", clients("a", 20), clients("a", 5), ["a-0"])]),
      [cam("a"), cam("b")],
    );
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

  it("computes both rates in clients, not emails", () => {
    // Four clients contacted, one replied and that one converted — even though
    // the CAM sent twelve emails to them.
    const board = camLeaderboard(
      summaryOf([person("a", clients("a", 4), ["a-0"], ["a-0"], 12)]),
      [cam("a")],
    );
    assert.equal(board.rows[0].emailsSent, 12);
    assert.equal(board.rows[0].contactedClients, 4);
    assert.equal(board.rows[0].replyRate, 0.25);
    assert.equal(board.rows[0].winRate, 1);
  });

  it("counts a converted client with no reply on record as a response", () => {
    // The union rule: won by phone call, no reply in the inbox. Counting it in
    // the numerator only would report 100% of nothing.
    const board = camLeaderboard(
      summaryOf([person("a", clients("a", 2), [], ["a-0"])]),
      [cam("a")],
    );
    assert.equal(board.rows[0].repliedClients, 0);
    assert.equal(board.rows[0].respondedClients, 1);
    assert.equal(board.rows[0].winRate, 1);
  });

  it("marks a CAM under the sample floor as low confidence, not as needing support", () => {
    const board = camLeaderboard(
      summaryOf([
        person("a", clients("a", MIN_SAMPLE_CONTACTS - 1), [], []),
        person("b", clients("b", 40), clients("b", 20), clients("b", 5)),
      ]),
      [cam("a"), cam("b")],
    );
    const a = board.rows.find((row) => row.userId === "a")!;
    assert.equal(a.lowConfidence, true);
    assert.equal(a.needsSupport, false);
    assert.equal(a.inactive, false);
  });

  it("measures the sample floor in contacted clients, not emails", () => {
    // Twelve emails to nine clients is still nine clients' worth of evidence.
    const board = camLeaderboard(
      summaryOf([person("a", clients("a", 9), [], [], 12)]),
      [cam("a")],
    );
    assert.equal(board.rows[0].lowConfidence, true);
  });

  it("flags a well-sampled CAM well below the team median reply rate", () => {
    // Median across sampled CAMs is 0.5; 0.05 is under 0.6 x 0.5 = 0.30.
    const board = camLeaderboard(
      summaryOf([
        person("a", clients("a", 20), clients("a", 1), []),
        person("b", clients("b", 20), clients("b", 10), []),
        person("c", clients("c", 20), clients("c", 10), []),
      ]),
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
      summaryOf([
        person("a", clients("a", 20), clients("a", 8), []),
        person("b", clients("b", 20), clients("b", 10), []),
        person("c", clients("c", 20), clients("c", 10), []),
      ]),
      [cam("a"), cam("b"), cam("c")],
    );
    assert.equal(board.needsSupportCount, 0);
  });

  it("flags nobody when the team median reply rate is zero", () => {
    const board = camLeaderboard(
      summaryOf([
        person("a", clients("a", 20), [], []),
        person("b", clients("b", 20), [], []),
      ]),
      [cam("a"), cam("b")],
    );
    assert.equal(board.medianReplyRate, 0);
    assert.equal(board.needsSupportCount, 0);
  });

  it("reports a null median when no CAM clears the sample floor", () => {
    const board = camLeaderboard(
      summaryOf([person("a", clients("a", 3), ["a-0"], [])]),
      [cam("a")],
    );
    assert.equal(board.medianReplyRate, null);
    assert.equal(board.needsSupportCount, 0);
  });

  it("averages the two middle rates for an even number of sampled CAMs", () => {
    const board = camLeaderboard(
      summaryOf([
        person("a", clients("a", 20), clients("a", 2), []),
        person("b", clients("b", 20), clients("b", 4), []),
        person("c", clients("c", 20), clients("c", 8), []),
        person("d", clients("d", 20), clients("d", 10), []),
      ]),
      [cam("a"), cam("b"), cam("c"), cam("d")],
    );
    // 0.1, 0.2, 0.4, 0.5 -> (0.2 + 0.4) / 2
    assert.ok(Math.abs((board.medianReplyRate ?? 0) - 0.3) < 1e-9);
  });

  it("takes the team row from the team's own clients, not an average of CAM rates", () => {
    const board = camLeaderboard(
      summaryOf(
        [
          person("a", clients("a", 90), [], [], 90),
          person("b", clients("b", 10), clients("b", 10), [], 10),
        ],
        { contacted: [...clients("a", 90), ...clients("b", 10)], replied: clients("b", 10), converted: [] },
      ),
      [cam("a"), cam("b")],
    );
    assert.equal(board.teamReplyRate, 0.1);
    assert.equal(board.teamWinRate, 0);
  });

  it("sorts by clients won, then responding clients, then contacted, then name", () => {
    const board = camLeaderboard(
      summaryOf([
        person("a", clients("a", 10), clients("a", 1), ["a-0"]),
        person("b", clients("b", 10), clients("b", 5), ["b-0", "b-1", "b-2"]),
        person("c", clients("c", 50), clients("c", 5), ["c-0"]),
      ]),
      [cam("a"), cam("b"), cam("c")],
    );
    assert.deepEqual(
      board.rows.map((row) => row.userId),
      ["b", "c", "a"],
    );
  });

  it("does not sort struggling CAMs to the top", () => {
    const board = camLeaderboard(
      summaryOf([
        person("a", clients("a", 20), clients("a", 1), []),
        person("b", clients("b", 20), clients("b", 10), clients("b", 4)),
        person("c", clients("c", 20), clients("c", 10), clients("c", 6)),
      ]),
      [cam("a"), cam("b"), cam("c")],
    );
    assert.equal(board.rows[0].userId, "c");
    assert.equal(board.rows.at(-1)!.userId, "a");
  });

  it("degrades to an empty board with no CAMs", () => {
    const board = camLeaderboard(summaryOf([]), []);
    assert.deepEqual(board.rows, []);
    assert.equal(board.teamReplyRate, null);
    assert.equal(board.teamWinRate, null);
    assert.equal(board.medianReplyRate, null);
  });
});
