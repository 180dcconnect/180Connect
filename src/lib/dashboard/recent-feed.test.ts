import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { FormattedRecentUpdate } from "../recent-updates.ts";
import type { FormattedTeamActivity } from "../team-activity.ts";
import { mergeDashboardFeed } from "./recent-feed.ts";

function update(overrides: Partial<FormattedRecentUpdate> = {}): FormattedRecentUpdate {
  return {
    id: "note-1",
    orgId: "org-1",
    orgName: "Oxford Homeless Project",
    href: "/clients/org-1",
    eventLabel: "Note added",
    subjectName: "Ada Lovelace",
    actionPhrase: "added a note on",
    mentionsClient: true,
    actorName: "Ada Lovelace",
    summary: "Called the director",
    relativeTime: "2 hours ago",
    timestamp: "2026-09-15T10:00:00Z",
    ...overrides,
  };
}

function team(overrides: Partial<FormattedTeamActivity> = {}): FormattedTeamActivity {
  return {
    id: "audit-9",
    actorName: "Sam Jones",
    actionLabel: "Suppression",
    sentence: "Sam Jones approved suppression of Wearside Youth",
    targetName: "Wearside Youth",
    targetHref: "/clients/org-2",
    actionButton: null,
    relativeTime: "1 hour ago",
    createdAt: "2026-09-15T11:00:00Z",
    ...overrides,
  };
}

describe("mergeDashboardFeed", () => {
  it("merges both sources newest first", () => {
    const feed = mergeDashboardFeed([update()], [team()]);
    assert.deepEqual(feed.map((item) => item.id), ["audit-9", "note-1"]);
  });

  it("drops a team row the recent updates already show from the same audit entry", () => {
    const feed = mergeDashboardFeed(
      [update({ id: "status-audit-1" }), update({ id: "ownership-audit-2" })],
      [team({ id: "audit-1" }), team({ id: "audit-2" }), team({ id: "audit-3" })],
    );
    assert.deepEqual(feed.map((item) => item.id).sort(), ["audit-3", "ownership-audit-2", "status-audit-1"]);
  });

  it("splits the actor off a team sentence so the name keeps its hover card", () => {
    const [item] = mergeDashboardFeed([], [team()]);
    assert.equal(item.subjectName, "Sam Jones");
    assert.equal(item.phrase, "approved suppression of Wearside Youth");
  });

  it("gives a team row with nothing to open no link", () => {
    const [item] = mergeDashboardFeed([], [team({ targetHref: null, actionButton: null })]);
    assert.equal(item.href, null);
  });

  it("prefers a team row's own button link over its target", () => {
    const [item] = mergeDashboardFeed(
      [],
      [team({ actionButton: { label: "View", href: "/team/u1" }, targetHref: "/clients/x" })],
    );
    assert.equal(item.href, "/team/u1");
  });

  it("names the client only when the update's sentence ends with it", () => {
    const [reply] = mergeDashboardFeed(
      [update({ subjectName: "Oxford Homeless Project", actionPhrase: "replied to your outreach", mentionsClient: false })],
      [],
    );
    assert.equal(reply.clientName, null);
    assert.equal(reply.subjectName, "Oxford Homeless Project");
  });
});
