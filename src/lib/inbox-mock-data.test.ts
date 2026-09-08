import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  MOCK_INBOX_THREADS,
  getMockThreadById,
  getMockContacts,
  mockFillThreads,
  searchRecipients,
} from "./inbox-mock-data.ts";
import {
  formatGmailTimestamp,
  formatFileSize,
  resolveDateFilter,
  searchThreads,
} from "./inbox-thread-view.ts";

describe("inbox-mock-data", () => {
  it("provides populated mock threads with required fields", () => {
    assert.ok(MOCK_INBOX_THREADS.length >= 10);
    for (const thread of MOCK_INBOX_THREADS) {
      assert.ok(thread.id);
      assert.ok(thread.orgName);
      assert.ok(thread.subject);
      assert.ok(thread.snippet);
      assert.ok(thread.messages.length > 0);
      assert.ok(thread.primaryContact.name);
      assert.ok(thread.primaryContact.email);
    }
  });

  it("finds mock thread by id", () => {
    const thread = getMockThreadById("mock-org-cruk");
    assert.ok(thread);
    assert.equal(thread?.orgName, "Cancer Research UK");
  });

  it("returns undefined for unknown thread id", () => {
    assert.equal(getMockThreadById("unknown-org-id"), undefined);
  });

  it("formats file sizes correctly in KB and MB", () => {
    assert.equal(formatFileSize(500000), "500 KB");
    assert.equal(formatFileSize(2500000), "2.5 MB");
  });

  it("formats timestamps cleanly", () => {
    const nowIso = new Date().toISOString();
    const formatted = formatGmailTimestamp(nowIso);
    assert.ok(formatted.length > 0);
  });

  it("matches nothing on a blank query", () => {
    assert.deepEqual(searchThreads(MOCK_INBOX_THREADS, ""), []);
    assert.deepEqual(searchThreads(MOCK_INBOX_THREADS, "   "), []);
  });

  it("ranks an organisation-name match above a subject-only match", () => {
    // "Oxfam" names the org on one thread; other threads only mention similar
    // words in subjects. The org hit must come first either way.
    const results = searchThreads(MOCK_INBOX_THREADS, "oxfam");
    assert.ok(results.length > 0);
    assert.equal(results[0].orgName, "Oxfam Great Britain");
  });

  it("finds threads by contact name", () => {
    const results = searchThreads(MOCK_INBOX_THREADS, "marcus vance");
    assert.ok(results.some((thread) => thread.id === "mock-org-cruk"));
  });

  it("is case-insensitive", () => {
    const lower = searchThreads(MOCK_INBOX_THREADS, "wellcome").map((t) => t.id);
    const upper = searchThreads(MOCK_INBOX_THREADS, "WELLCOME").map((t) => t.id);
    assert.deepEqual(lower, upper);
    assert.ok(lower.length > 0);
  });

  it("resolves date presets to ranges containing now", () => {
    // Local calendar days throughout, so the assertions hold in any timezone.
    const now = new Date(2026, 8, 6, 12, 0, 0);
    for (const value of ["today", "7d", "30d", "this_month"]) {
      const range = resolveDateFilter(value, now);
      assert.ok(range);
      assert.ok(range.from <= now.getTime() && now.getTime() <= range.to);
    }
    const yesterday = resolveDateFilter("yesterday", now);
    assert.ok(yesterday);
    assert.ok(yesterday.to < new Date(2026, 8, 6).getTime());
    const lastMonth = resolveDateFilter("last_month", now);
    assert.ok(lastMonth);
    assert.ok(new Date(lastMonth.to) < new Date(2026, 8, 1));
  });

  it("resolves single days and ranges, and rejects junk", () => {
    const day = resolveDateFilter("2026-09-06", new Date(2026, 8, 6, 12));
    assert.ok(day);
    assert.deepEqual(
      day,
      resolveDateFilter("2026-09-06..2026-09-06", new Date(2026, 8, 6, 12)),
    );
    const span = resolveDateFilter("2026-09-01..2026-09-06", new Date(2026, 8, 6, 12));
    assert.ok(span && span.from < span.to);
    assert.equal(resolveDateFilter("banana", new Date()), null);
    assert.equal(resolveDateFilter("2026-13-99", new Date()), null);
  });
});

/**
 * Every local part active in `public.personal_email_role_parts` (F247,
 * migration 20260818100400). `app.is_personal_email` lowercases a local part,
 * splits it on `[._+-]`, and calls the address personal unless one of the
 * resulting words is in this set — an allow-list, so an unknown word is
 * personal by default. Kept here as a literal because the mock has no database
 * to read the table from; if an admin adds a part, this list may lag, which is
 * the safe direction (it can only reject an address the platform would accept).
 */
const ROLE_LOCAL_PARTS = new Set([
  "accounts", "admin", "board", "bookings", "careers", "ceo", "chair",
  "charity", "comms", "communications", "contact", "contactus", "director",
  "donate", "donations", "email", "enquiries", "enquiry", "events", "finance",
  "fundraising", "general", "giving", "hello", "help", "helpdesk", "hr",
  "info", "invoices", "jobs", "mail", "manager", "marketing", "media",
  "noreply", "office", "partnerships", "press", "reception", "recruitment",
  "reply", "safeguarding", "secretary", "support", "team", "treasurer",
  "trustees", "volunteer", "volunteering",
]);

/** The same verdict `app.is_personal_email` reaches, in TypeScript. */
function isPersonalEmail(address: string): boolean {
  if (address.indexOf("@") < 1) return false;
  const local = address.split("@")[0].toLowerCase();
  return !local.split(/[._+-]/).some((word) => ROLE_LOCAL_PARTS.has(word));
}

describe("mock recipients carry no personal email addresses", () => {
  // 180DC's own staff are USERS of the platform, not third parties it holds
  // data about — the risk register governs what is stored about other people.
  const isOurs = (address: string) => address.endsWith("@180dc.org");

  it("every organisation address in the mock is a role address", () => {
    const offenders: string[] = [];

    for (const thread of MOCK_INBOX_THREADS) {
      const addresses = [
        thread.primaryContact.email,
        ...getMockContacts(thread).map((contact) => contact.email),
        ...thread.messages.flatMap((message) => [
          message.senderEmail,
          message.recipientEmail,
        ]),
      ];
      for (const address of addresses) {
        if (!isOurs(address) && isPersonalEmail(address)) offenders.push(address);
      }
    }

    assert.deepEqual(
      [...new Set(offenders)],
      [],
      "Risk register §5 bans storing personal email addresses in any form. " +
        "Use a role inbox from personal_email_role_parts instead.",
    );
  });

  it("never surfaces a personal address through recipient search", () => {
    for (const query of ["oxfam", "cancer", "trust", "info", "a"]) {
      for (const match of searchRecipients(query, 20)) {
        assert.equal(
          isPersonalEmail(match.contact.email),
          false,
          `searchRecipients("${query}") offered ${match.contact.email}`,
        );
      }
    }
  });

  it("still gives an organisation more than one address to choose from", () => {
    const contacts = getMockContacts(MOCK_INBOX_THREADS[0]);
    assert.ok(contacts.length >= 2);
    assert.equal(new Set(contacts.map((c) => c.email)).size, contacts.length);
    assert.equal(contacts.filter((c) => c.isPrimary).length, 1);
  });
});

describe("mockFillThreads", () => {
  it("serves the fill by default and clears it on NEXT_PUBLIC_INBOX_MOCK_FILL=0", () => {
    const previous = process.env.NEXT_PUBLIC_INBOX_MOCK_FILL;
    try {
      delete process.env.NEXT_PUBLIC_INBOX_MOCK_FILL;
      assert.equal(mockFillThreads(), MOCK_INBOX_THREADS);
      process.env.NEXT_PUBLIC_INBOX_MOCK_FILL = "0";
      assert.deepEqual(mockFillThreads(), []);
      process.env.NEXT_PUBLIC_INBOX_MOCK_FILL = "false";
      assert.deepEqual(mockFillThreads(), []);
    } finally {
      if (previous === undefined) delete process.env.NEXT_PUBLIC_INBOX_MOCK_FILL;
      else process.env.NEXT_PUBLIC_INBOX_MOCK_FILL = previous;
    }
  });
});
