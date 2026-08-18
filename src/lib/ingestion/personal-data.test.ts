import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isPersonalEmail,
  redactPayload,
  redactText,
  REDACTED_EMAIL,
  REDACTED_PHONE,
  resolveRedactionsForSource,
  type RedactionKind,
  type RedactionRule,
} from "./personal-data.ts";

/**
 * The role parts these tests run against.
 *
 * A subset of what the migration seeds, chosen to cover each shape the splitter
 * has to handle rather than to mirror the seed — a test that asserted all 49
 * would fail every time an admin adds one, which is the thing the table exists to
 * let them do.
 */
const ROLE_PARTS = new Set([
  "info",
  "contact",
  "enquiries",
  "fundraising",
  "trustees",
  "chair",
  "office",
  "noreply",
  "reply",
]);

const EMAILS = new Set<RedactionKind>(["redact_personal_email"]);
const PHONES = new Set<RedactionKind>(["redact_phone_number"]);

// ---------------------------------------------------------------------------
// isPersonalEmail — the allow-list
// ---------------------------------------------------------------------------

describe("isPersonalEmail", () => {
  it("treats a named individual's address as personal", () => {
    assert.equal(isPersonalEmail("jane.smith@acme.org", ROLE_PARTS), true);
    assert.equal(isPersonalEmail("jsmith@acme.org", ROLE_PARTS), true);
    assert.equal(isPersonalEmail("bashir@acme.org", ROLE_PARTS), true);
  });

  it("keeps a role address", () => {
    assert.equal(isPersonalEmail("info@acme.org", ROLE_PARTS), false);
    assert.equal(isPersonalEmail("fundraising@acme.org", ROLE_PARTS), false);
  });

  it("keeps a role address wearing a suffix", () => {
    // The reason the local part is split into words rather than looked up whole:
    // these are the forms real charity sites actually publish.
    assert.equal(isPersonalEmail("info-sheffield@acme.org", ROLE_PARTS), false);
    assert.equal(isPersonalEmail("fundraising.team@acme.org", ROLE_PARTS), false);
    assert.equal(isPersonalEmail("enquiries_2026@acme.org", ROLE_PARTS), false);
    assert.equal(isPersonalEmail("contact+web@acme.org", ROLE_PARTS), false);
    assert.equal(isPersonalEmail("no-reply@acme.org", ROLE_PARTS), false);
  });

  it("does not keep an address for merely containing a role as a substring", () => {
    // The whole reason for splitting on separators rather than using `includes`.
    // `joanne` contains `jo`; `officer` contains `office`; `chairman` contains
    // `chair`. All three name people or roles held by one identifiable person.
    assert.equal(isPersonalEmail("joanne@acme.org", ROLE_PARTS), true);
    assert.equal(isPersonalEmail("officergreen@acme.org", ROLE_PARTS), true);
    assert.equal(isPersonalEmail("chairmanjones@acme.org", ROLE_PARTS), true);
  });

  it("is case-insensitive on the local part", () => {
    assert.equal(isPersonalEmail("INFO@acme.org", ROLE_PARTS), false);
    assert.equal(isPersonalEmail("Jane.Smith@acme.org", ROLE_PARTS), true);
  });

  it("treats an unknown local part as personal", () => {
    // The allow-list direction, asserted directly: this is what makes the control
    // safe as the platform meets local parts nobody anticipated.
    assert.equal(isPersonalEmail("xyzzy@acme.org", ROLE_PARTS), true);
    assert.equal(isPersonalEmail("anything@acme.org", new Set()), true);
  });

  it("has no opinion about a string that is not an address", () => {
    assert.equal(isPersonalEmail("not an email", ROLE_PARTS), false);
    assert.equal(isPersonalEmail("@acme.org", ROLE_PARTS), false);
    assert.equal(isPersonalEmail("", ROLE_PARTS), false);
  });

  it("reads the domain from the last @, not the first", () => {
    // A quoted local part can legally contain an @. Splitting on the first one
    // would read the address as a role called whatever preceded it.
    assert.equal(isPersonalEmail('"jane@home"@acme.org', ROLE_PARTS), true);
  });
});

// ---------------------------------------------------------------------------
// redactText
// ---------------------------------------------------------------------------

describe("redactText — emails", () => {
  it("replaces a personal address and leaves the surrounding prose", () => {
    const { text, counts } = redactText(
      "Contact Jane on jane.smith@acme.org for details.",
      EMAILS,
      ROLE_PARTS,
    );
    assert.equal(text, `Contact Jane on ${REDACTED_EMAIL} for details.`);
    assert.equal(counts.redact_personal_email, 1);
  });

  it("leaves a role address in place", () => {
    const { text, counts } = redactText(
      "Email info@acme.org",
      EMAILS,
      ROLE_PARTS,
    );
    assert.equal(text, "Email info@acme.org");
    assert.equal(counts.redact_personal_email, undefined);
  });

  it("handles both kinds in one string", () => {
    const { text, counts } = redactText(
      "info@acme.org or jane@acme.org",
      EMAILS,
      ROLE_PARTS,
    );
    assert.equal(text, `info@acme.org or ${REDACTED_EMAIL}`);
    assert.equal(counts.redact_personal_email, 1);
  });

  it("reaches an address inside markup, including a mailto href", () => {
    // The case the field-level rules cannot express, and the reason this module
    // exists: there is no path that names this address.
    const html =
      '<p>Our fundraiser <a href="mailto:jane.smith@acme.org">Jane Smith</a></p>';
    const { text, counts } = redactText(html, EMAILS, ROLE_PARTS);

    assert.equal(text.includes("jane.smith@acme.org"), false);
    // Both the href and nothing else — the anchor text is a name, which this
    // detector does not claim to find. See the documented limit in
    // docs/personal-data-exclusions.md.
    assert.equal(counts.redact_personal_email, 1);
    assert.equal(text.includes("Jane Smith"), true);
  });

  it("counts every occurrence", () => {
    const { counts } = redactText(
      "a@x.org b@x.org c@x.org",
      EMAILS,
      ROLE_PARTS,
    );
    assert.equal(counts.redact_personal_email, 3);
  });

  it("does nothing when the email detector is not enabled", () => {
    const { text } = redactText("jane@acme.org", PHONES, ROLE_PARTS);
    assert.equal(text, "jane@acme.org");
  });
});

describe("redactText — phone numbers", () => {
  it("replaces UK numbers in the formats sites actually print", () => {
    for (const number of [
      "0114 222 1234",
      "0114-222-1234",
      "01142221234",
      "+44 114 222 1234",
      "+44 (0)114 222 1234",
      "07700 900123",
      "0044 114 222 1234",
    ]) {
      const { text, counts } = redactText(
        `Call us on ${number} today`,
        PHONES,
        ROLE_PARTS,
      );
      assert.equal(
        text,
        `Call us on ${REDACTED_PHONE} today`,
        `failed on ${number}`,
      );
      assert.equal(counts.redact_phone_number, 1, `failed on ${number}`);
    }
  });

  it("leaves registration numbers alone", () => {
    // The single most important assertion in this file. A looser pattern would
    // eat the identifiers the platform exists to collect, and it would do it
    // silently — the record would still import, just without its charity number.
    for (const identifier of [
      "1164883", // charity number, England and Wales
      "15874544", // company number
      "SC012345", // Scottish charity number
      "NIC101234", // Northern Ireland charity number
      "2024", // a year
      "£25000", // an amount
    ]) {
      const input = `Registered ${identifier} with the regulator`;
      const { text, counts } = redactText(input, PHONES, ROLE_PARTS);
      assert.equal(text, input, `wrongly redacted ${identifier}`);
      assert.equal(counts.redact_phone_number, undefined);
    }
  });

  it("does not redact a number in an email address it also matched", () => {
    // Emails run first, so the address is already a placeholder by the time the
    // phone pattern sees the string.
    const kinds = new Set<RedactionKind>([
      "redact_personal_email",
      "redact_phone_number",
    ]);
    const { text } = redactText("jane0114222@acme.org", kinds, ROLE_PARTS);
    assert.equal(text, REDACTED_EMAIL);
  });
});

// ---------------------------------------------------------------------------
// resolveRedactionsForSource
// ---------------------------------------------------------------------------

describe("resolveRedactionsForSource", () => {
  const rules: RedactionRule[] = [
    { source: null, field_path: "*", kind: "redact_personal_email" },
    { source: null, field_path: "html", kind: "redact_phone_number" },
    { source: "charitybase", field_path: "bio", kind: "redact_personal_email" },
  ];

  it("gives every source the global rules", () => {
    const resolved = resolveRedactionsForSource(rules, "companies_house");
    assert.deepEqual([...(resolved.get("*") ?? [])], ["redact_personal_email"]);
    assert.deepEqual([...(resolved.get("html") ?? [])], ["redact_phone_number"]);
    assert.equal(resolved.has("bio"), false);
  });

  it("adds a source-specific rule to the global ones", () => {
    const resolved = resolveRedactionsForSource(rules, "charitybase");
    assert.equal(resolved.size, 3);
    assert.deepEqual([...(resolved.get("bio") ?? [])], ["redact_personal_email"]);
  });

  it("accumulates kinds on one field rather than overriding", () => {
    // Unlike field rules, where a source-specific rule replaces a global one:
    // two redaction kinds on the same field both have work to do, and picking one
    // would silently disable the other.
    const both = resolveRedactionsForSource(
      [
        { source: null, field_path: "html", kind: "redact_personal_email" },
        { source: "companies_house", field_path: "html", kind: "redact_phone_number" },
      ],
      "companies_house",
    );
    assert.equal(both.get("html")?.size, 2);
  });
});

// ---------------------------------------------------------------------------
// redactPayload
// ---------------------------------------------------------------------------

const GLOBAL_EMAIL: RedactionRule[] = [
  { source: null, field_path: "*", kind: "redact_personal_email" },
];

describe("redactPayload", () => {
  it("walks nested objects and arrays for the * path", () => {
    const payload = {
      name: "Acme",
      contacts: [
        { role: "Fundraiser", email: "jane@acme.org" },
        { role: "General", email: "info@acme.org" },
      ],
      nested: { deep: { note: "reach dave@acme.org" } },
    };

    const { redacted, applied, counts } = redactPayload(
      payload,
      GLOBAL_EMAIL,
      "charitybase",
      ROLE_PARTS,
    );

    assert.deepEqual(redacted, {
      name: "Acme",
      contacts: [
        { role: "Fundraiser", email: REDACTED_EMAIL },
        { role: "General", email: "info@acme.org" },
      ],
      nested: { deep: { note: `reach ${REDACTED_EMAIL}` } },
    });
    assert.deepEqual(applied, ["*#redact_personal_email"]);
    assert.equal(counts.redact_personal_email, 2);
  });

  it("returns the payload untouched when nothing matches", () => {
    // Referential identity, not just deep equality: an untouched payload keeps
    // its checksum, which is what stops the backfill rewriting the whole table.
    const payload = { name: "Acme", email: "info@acme.org" };
    const { redacted, applied } = redactPayload(
      payload,
      GLOBAL_EMAIL,
      "charitybase",
      ROLE_PARTS,
    );

    assert.equal(redacted, payload);
    assert.deepEqual(applied, []);
  });

  it("returns the payload untouched when no rule covers the source", () => {
    const payload = { email: "jane@acme.org" };
    const { redacted, applied } = redactPayload(
      payload,
      [{ source: "charitybase", field_path: "*", kind: "redact_personal_email" }],
      "companies_house",
      ROLE_PARTS,
    );

    assert.equal(redacted, payload);
    assert.deepEqual(applied, []);
  });

  it("scans only the named field when the path is not *", () => {
    const payload = {
      html: "<p>jane@acme.org</p>",
      source_note: "found via dave@acme.org",
    };

    const { redacted } = redactPayload(
      payload,
      [{ source: null, field_path: "html", kind: "redact_personal_email" }],
      "website",
      ROLE_PARTS,
    );

    assert.deepEqual(redacted, {
      html: `<p>${REDACTED_EMAIL}</p>`,
      source_note: "found via dave@acme.org",
    });
  });

  it("follows a dotted path", () => {
    const payload = { contact_info: { email: "jane@acme.org" }, name: "dave@acme.org" };

    const { redacted, applied } = redactPayload(
      payload,
      [
        {
          source: null,
          field_path: "contact_info.email",
          kind: "redact_personal_email",
        },
      ],
      "charity_commission",
      ROLE_PARTS,
    );

    assert.deepEqual(redacted, {
      contact_info: { email: REDACTED_EMAIL },
      name: "dave@acme.org",
    });
    assert.deepEqual(applied, ["contact_info.email#redact_personal_email"]);
  });

  it("is a no-op for a path the payload does not have", () => {
    const payload = { name: "Acme" };
    const { redacted, applied } = redactPayload(
      payload,
      [{ source: null, field_path: "html", kind: "redact_phone_number" }],
      "companies_house",
      ROLE_PARTS,
    );

    assert.equal(redacted, payload);
    assert.deepEqual(applied, []);
  });

  it("records a rule only when it matched, not merely when it ran", () => {
    // `applied` is written to raw_source_records.excluded_fields and aggregated by
    // data_handling_filter_summary(), whose one job is telling an admin which
    // rules earn their place. A rule logged on every row it was checked against
    // would make that number meaningless.
    const payload = { html: "<p>info@acme.org 0114 222 1234</p>" };
    const { applied } = redactPayload(
      payload,
      [
        { source: null, field_path: "html", kind: "redact_personal_email" },
        { source: null, field_path: "html", kind: "redact_phone_number" },
      ],
      "website",
      ROLE_PARTS,
    );

    assert.deepEqual(applied, ["html#redact_phone_number"]);
  });

  it("leaves non-string values alone", () => {
    const payload = {
      income: 250000,
      active: true,
      dissolved_on: null,
      tags: ["health", "youth"],
    };
    const { redacted } = redactPayload(
      payload,
      GLOBAL_EMAIL,
      "charitybase",
      ROLE_PARTS,
    );
    assert.deepEqual(redacted, payload);
  });

  it("is idempotent — redacting a redacted payload changes nothing", () => {
    const once = redactPayload(
      { note: "jane@acme.org" },
      GLOBAL_EMAIL,
      "charitybase",
      ROLE_PARTS,
    );
    const twice = redactPayload(
      once.redacted,
      GLOBAL_EMAIL,
      "charitybase",
      ROLE_PARTS,
    );

    assert.deepEqual(twice.redacted, once.redacted);
    assert.deepEqual(twice.applied, []);
  });
});
