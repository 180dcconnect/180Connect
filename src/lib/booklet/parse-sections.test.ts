import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseBookletSections } from "./parse-sections.ts";

describe("parseBookletSections", () => {
  it("splits a labelled section into a heading and a paragraph", () => {
    const result = parseBookletSections(
      "Overview:\nTest Charity is a charity located in London.",
    );
    assert.deepEqual(result, [
      { type: "heading", text: "Overview" },
      { type: "paragraph", text: "Test Charity is a charity located in London." },
    ]);
  });

  it("joins multiple wrapped lines of one paragraph into a single paragraph", () => {
    const result = parseBookletSections(
      "What they do:\nThey help young people into jobs.\nThey run CV workshops too.",
    );
    assert.deepEqual(result, [
      { type: "heading", text: "What they do" },
      { type: "paragraph", text: "They help young people into jobs. They run CV workshops too." },
    ]);
  });

  it("turns a block of dash-bulleted lines into a list", () => {
    const result = parseBookletSections(
      "Outreach angles:\n- Discuss their youth programmes.\n- Ask about local partnerships.",
    );
    assert.deepEqual(result, [
      { type: "heading", text: "Outreach angles" },
      {
        type: "list",
        items: ["Discuss their youth programmes.", "Ask about local partnerships."],
      },
    ]);
  });

  it("handles multiple sections separated by blank lines", () => {
    const result = parseBookletSections(
      "Overview:\nA charity in London.\n\nOutreach angles:\n- Ask about their mission.",
    );
    assert.deepEqual(result, [
      { type: "heading", text: "Overview" },
      { type: "paragraph", text: "A charity in London." },
      { type: "heading", text: "Outreach angles" },
      { type: "list", items: ["Ask about their mission."] },
    ]);
  });

  it("treats text with no labelled sections as a single paragraph", () => {
    const result = parseBookletSections("Just a plain sentence with no label at all.");
    assert.deepEqual(result, [
      { type: "paragraph", text: "Just a plain sentence with no label at all." },
    ]);
  });

  it("does not treat a colon-ending line with no body as a heading", () => {
    // A lone line matching the heading shape, with nothing after it in its block,
    // is not actually a section break — headingFrom requires a body to attach to.
    const result = parseBookletSections("Note:");
    assert.deepEqual(result, [{ type: "paragraph", text: "Note:" }]);
  });

  it("does not mistake a long sentence ending in a colon for a heading", () => {
    const result = parseBookletSections(
      "The profile is missing several fields including the following:\nWebsite and sector.",
    );
    assert.deepEqual(result, [
      {
        type: "paragraph",
        text: "The profile is missing several fields including the following: Website and sector.",
      },
    ]);
  });
});
