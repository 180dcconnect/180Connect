import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fieldSearchQuery, webSearchHref, WEB_SEARCH_LABEL } from "./web-search.ts";

describe("fieldSearchQuery", () => {
  it("asks for the detail using a natural-language question", () => {
    assert.equal(fieldSearchQuery("website", "Sheffield Mind"), "What is Sheffield Mind's website?");
    assert.equal(
      fieldSearchQuery("mission", "Sheffield Mind"),
      "What is Sheffield Mind's mission statement?",
    );
    assert.equal(fieldSearchQuery("sector", "Sheffield Mind"), "What is Sheffield Mind's sector?");
    assert.equal(fieldSearchQuery("email", "Sheffield Mind"), "What is Sheffield Mind's email address?");
  });

  it("searches for an address rather than the word city", () => {
    assert.equal(fieldSearchQuery("city", "Sheffield Mind"), "What is Sheffield Mind's address?");
  });

  it("tidies the name it is given", () => {
    assert.equal(fieldSearchQuery("website", "  Sheffield Mind  "), "What is Sheffield Mind's website?");
    // A stray quote in a trading name would otherwise break the phrase apart.
    assert.equal(fieldSearchQuery("website", 'Minds "R" Us'), "What is Minds R Us's website?");
  });

  it("asks the question without a name when there is no name", () => {
    assert.equal(fieldSearchQuery("website", "   "), "What is the website?");
  });
});

describe("webSearchHref", () => {
  it("encodes the query into a search address", () => {
    assert.equal(
      webSearchHref("website", "Sheffield Mind"),
      "https://www.google.com/search?q=What%20is%20Sheffield%20Mind's%20website%3F",
    );
  });

  it("encodes punctuation rather than pasting it in raw", () => {
    const href = webSearchHref("mission", "St Mary's & St Paul's Trust");
    assert.ok(href.startsWith("https://www.google.com/search?q="));
    assert.ok(!href.includes(" "));
    assert.ok(href.includes("%26"));
  });
});

describe("WEB_SEARCH_LABEL", () => {
  it("is one phrasing for every field", () => {
    assert.equal(WEB_SEARCH_LABEL, "Search");
  });
});
