import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { renderSheet, slugifySheetName } from "./export-data-model.mts";

describe("slugifySheetName", () => {
  it("normalises spacing, case and trailing space", () => {
    assert.equal(slugifySheetName("04 Entities "), "04-entities");
    assert.equal(slugifySheetName("05 - Feature Store "), "05-feature-store");
  });
});

describe("renderSheet", () => {
  const markdown = renderSheet({
    name: "04 Entities ",
    rows: [
      ["ORGANISATIONS", "", ""],
      ["Field", "Type", "Nullable"],
      ["id", "uuid", "No"],
      ["", "", ""],
      ["CONTACTS", "", ""],
      ["Field", "Type", "Nullable"],
      ["email", "text", "Yes"],
    ],
  });

  it("renders a lone value as a block heading", () => {
    assert.match(markdown, /## ORGANISATIONS/);
    assert.match(markdown, /## CONTACTS/);
  });

  it("renders the row after a heading as a table header", () => {
    assert.match(markdown, /\| Field \| Type \| Nullable \|/);
    assert.match(markdown, /\| :--- \| :--- \| :--- \|/);
  });

  it("renders field rows as table rows", () => {
    assert.match(markdown, /\| id \| uuid \| No \|/);
    assert.match(markdown, /\| email \| text \| Yes \|/);
  });

  it("gives each block its own header, not one shared table", () => {
    const separatorLines = markdown.match(/^\| :--- \|/gm) ?? [];
    assert.equal(separatorLines.length, 2);
  });

  it("escapes pipes so a cell cannot break the table", () => {
    const out = renderSheet({
      name: "x",
      rows: [
        ["Field", "Notes"],
        ["kind", "a | b"],
      ],
    });
    assert.match(out, /a \\\| b/);
  });
});
