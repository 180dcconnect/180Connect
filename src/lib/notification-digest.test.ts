import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildDigestEmail,
  digestWindowStart,
  isDigestDue,
  isLondonDigestHour,
  isLondonMonday,
  type DigestNotification,
} from "./notification-digest.ts";

// 14 Sep 2026 is a Monday. September is BST, so 08:00 UTC is 9am in London —
// the cron's digest run.
const MONDAY = new Date("2026-09-14T08:00:00Z");
const TUESDAY = new Date("2026-09-15T08:00:00Z");
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const ago = (from: Date, ms: number) => new Date(from.getTime() - ms);

describe("digest hour (9am UK time)", () => {
  it("is 08:00 UTC in summer, not 09:00 UTC", () => {
    assert.equal(isLondonDigestHour(new Date("2026-09-15T08:00:00Z")), true);
    assert.equal(isLondonDigestHour(new Date("2026-09-15T09:00:00Z")), false);
  });

  it("is 09:00 UTC in winter, not 08:00 UTC", () => {
    assert.equal(isLondonDigestHour(new Date("2026-01-06T09:00:00Z")), true);
    assert.equal(isLondonDigestHour(new Date("2026-01-06T08:00:00Z")), false);
  });

  it("sends nothing on the cron run that is not 9am in London", () => {
    assert.equal(isDigestDue("daily", null, new Date("2026-09-15T09:00:00Z")), false);
  });

  it("sends weekly on a winter Monday's 9am run", () => {
    // 5 Jan 2026 is a Monday.
    assert.equal(isDigestDue("weekly", null, new Date("2026-01-05T09:00:00Z")), true);
  });
});

describe("isDigestDue", () => {
  it("never sends to immediate", () => {
    assert.equal(isDigestDue("immediate", null, MONDAY), false);
  });

  it("sends a first daily digest", () => {
    assert.equal(isDigestDue("daily", null, TUESDAY), true);
  });

  it("does not send daily twice in one day", () => {
    assert.equal(isDigestDue("daily", ago(TUESDAY, 10 * HOUR), TUESDAY), false);
  });

  it("still sends daily when today's run is a little earlier than yesterday's", () => {
    assert.equal(isDigestDue("daily", ago(TUESDAY, 24 * HOUR - 30_000), TUESDAY), true);
  });

  it("sends weekly only on Mondays", () => {
    assert.equal(isLondonMonday(MONDAY), true);
    assert.equal(isDigestDue("weekly", null, TUESDAY), false);
    assert.equal(isDigestDue("weekly", null, MONDAY), true);
  });

  it("does not send weekly twice in a week", () => {
    assert.equal(isDigestDue("weekly", ago(MONDAY, 3 * DAY), MONDAY), false);
    assert.equal(isDigestDue("weekly", ago(MONDAY, 7 * DAY), MONDAY), true);
  });
});

describe("digestWindowStart", () => {
  it("opens at the last digest when it is within the period", () => {
    const last = ago(TUESDAY, 23 * HOUR);
    assert.equal(digestWindowStart("daily", last, TUESDAY).getTime(), last.getTime());
  });

  it("never reaches more than one period back", () => {
    assert.equal(
      digestWindowStart("weekly", ago(MONDAY, 60 * DAY), MONDAY).getTime(),
      ago(MONDAY, 7 * DAY).getTime(),
    );
    assert.equal(
      digestWindowStart("daily", null, TUESDAY).getTime(),
      ago(TUESDAY, DAY).getTime(),
    );
  });
});

describe("buildDigestEmail", () => {
  const reply: DigestNotification = {
    notification_type: "client_reply_received",
    title: "Sheffield Youth Futures replied",
    body: "Thanks — happy to talk\nnext week.",
    link_path: "/clients/abc",
    created_at: "2026-09-14T01:00:00Z",
  };
  const followUp: DigestNotification = {
    notification_type: "follow_up_due",
    title: "Follow up with Hope Kitchen",
    body: null,
    link_path: "/clients/def",
    created_at: "2026-09-13T20:00:00Z",
  };

  const build = (overrides: Partial<Parameters<typeof buildDigestEmail>[0]> = {}) =>
    buildDigestEmail({
      frequency: "daily",
      recipientName: "Amina Yusuf",
      notifications: [reply, followUp],
      totalUnread: 2,
      windowStart: ago(MONDAY, DAY),
      appUrl: "https://180connect.example",
      ...overrides,
    });

  it("counts unread in the subject, singular and plural", () => {
    assert.equal(build().subject, "Your daily 180Connect digest: 2 unread notifications");
    assert.equal(
      build({ frequency: "weekly", notifications: [reply], totalUnread: 1 }).subject,
      "Your weekly 180Connect digest: 1 unread notification",
    );
  });

  it("greets by first name, groups by kind in plain English, and links absolutely", () => {
    const { text } = build();
    assert.ok(text.startsWith("Hi Amina,"));
    assert.ok(text.includes("A client replies (1)"));
    assert.ok(text.includes("A follow-up is due (1)"));
    assert.ok(text.includes("https://180connect.example/clients/abc"));
    assert.ok(text.includes("Thanks — happy to talk next week."));
    assert.ok(!text.includes("client_reply_received"));
  });

  it("lists replies before follow-ups, in the catalogue's order", () => {
    const { text } = build({ notifications: [followUp, reply] });
    assert.ok(text.indexOf("A client replies") < text.indexOf("A follow-up is due"));
  });

  it("counts what it could not list", () => {
    assert.ok(build({ totalUnread: 45 }).text.includes("…and 43 more waiting in 180Connect."));
  });

  it("says why it was sent and how to stop it", () => {
    const { text } = build();
    assert.ok(text.includes("Daily digest"));
    assert.ok(text.includes("https://180connect.example/settings/notifications"));
  });
});
