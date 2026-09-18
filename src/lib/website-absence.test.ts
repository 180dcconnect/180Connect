import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  hasResolvedWebsite,
  websiteAbsenceFailureMessage,
  websiteAbsenceSavedMessage,
} from "./website-absence.ts";

describe("hasResolvedWebsite", () => {
  it("accepts either a real website or a confirmed absence", () => {
    assert.equal(
      hasResolvedWebsite({
        website: "https://example.org",
        websiteAbsentAt: null,
      }),
      true,
    );
    assert.equal(
      hasResolvedWebsite({
        website: null,
        websiteAbsentAt: "2026-09-18T09:00:00Z",
      }),
      true,
    );
  });

  it("keeps an unconfirmed blank or redacted website incomplete", () => {
    assert.equal(
      hasResolvedWebsite({ website: "   ", websiteAbsentAt: null }),
      false,
    );
    assert.equal(
      hasResolvedWebsite({
        website: "https://redacted.example",
        websiteAbsentAt: null,
        websiteIsRedacted: true,
      }),
      false,
    );
  });
});

describe("websiteAbsenceFailureMessage", () => {
  it("says who can record the mark", () => {
    assert.equal(
      websiteAbsenceFailureMessage({ code: "42501" }),
      "Only an admin can record that a client has no website.",
    );
  });

  it("explains a client that now has a website, and what to do", () => {
    const message = websiteAbsenceFailureMessage({ code: "23514" });
    assert.match(message, /already has a website|has a website on file|now has a website/);
    assert.match(message, /Refresh the page/);
  });

  it("handles a client that has since disappeared", () => {
    assert.equal(
      websiteAbsenceFailureMessage({ code: "P0002" }),
      "That client could not be found. Refresh the page and try again.",
    );
  });

  it("never leaks internals for an unexpected failure", () => {
    const message = websiteAbsenceFailureMessage({
      code: "42P01",
      message: 'relation "organisations" does not exist',
    });
    assert.equal(message, "That could not be saved. Refresh the page and try again.");
    assert.doesNotMatch(message, /organisations|42P01|relation/);
  });
});

describe("websiteAbsenceSavedMessage", () => {
  it("names the client and the direction of the change", () => {
    assert.equal(
      websiteAbsenceSavedMessage(true, "Amazon Ltd"),
      "Recorded that Amazon Ltd has no website",
    );
    assert.equal(
      websiteAbsenceSavedMessage(false, "Amazon Ltd"),
      "Amazon Ltd is back on the website list",
    );
  });
});
