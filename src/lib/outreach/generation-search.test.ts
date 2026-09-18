import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_GENERATION_PAGE_SIZE,
  GENERATION_CLIENT_MATCH_LIMIT,
  GENERATION_PAGE_SIZES,
  GENERATION_SEARCH_MAX_LENGTH,
  cleanSearchTerm,
  describeGenerationFilters,
  generationSearchOrExpression,
  generationSearchPattern,
  orSafeSearchTerm,
  parseEdited,
  parseGenerationPage,
  parseModels,
} from "./generation-search.ts";

describe("cleanSearchTerm", () => {
  it("trims and collapses whitespace", () => {
    assert.equal(cleanSearchTerm("  Sheffield   Mind  "), "Sheffield Mind");
  });

  it("treats blank input as no search at all", () => {
    assert.equal(cleanSearchTerm(""), null);
    assert.equal(cleanSearchTerm("   "), null);
    assert.equal(cleanSearchTerm(undefined), null);
    assert.equal(cleanSearchTerm(null), null);
  });

  it("caps the term so a pasted paragraph cannot reach a query string", () => {
    const term = cleanSearchTerm("a".repeat(500));
    assert.equal(term?.length, GENERATION_SEARCH_MAX_LENGTH);
  });
});

describe("generationSearchPattern", () => {
  it("contains-matches the term", () => {
    assert.equal(generationSearchPattern("Sheffield"), "%Sheffield%");
  });

  it("makes the reader's own wildcards literal", () => {
    // "_i_" must match an underscore, not any three characters.
    assert.equal(generationSearchPattern("M_i_nd"), "%M\\_i\\_nd%");
    assert.equal(generationSearchPattern("50%"), "%50\\%%");
  });
});

describe("orSafeSearchTerm", () => {
  it("keeps the words and drops what would break the expression", () => {
    assert.equal(orSafeSearchTerm("Mind, (Sheffield)"), "Mind Sheffield");
    assert.equal(orSafeSearchTerm("O'Brien & Co"), "O Brien & Co");
  });

  it("strips a comma that would otherwise end the condition early", () => {
    assert.ok(!orSafeSearchTerm("a,b").includes(","));
  });
});

describe("generationSearchOrExpression", () => {
  it("searches the subject when there is no client match", () => {
    assert.equal(
      generationSearchOrExpression("Sheffield", []),
      "generated_subject.ilike.%Sheffield%",
    );
  });

  it("searches the subject and the matching clients' messages together", () => {
    assert.equal(
      generationSearchOrExpression("Sheffield", ["msg-1", "msg-2"]),
      "generated_subject.ilike.%Sheffield%,outreach_message_id.in.(msg-1,msg-2)",
    );
  });

  it("falls back to the client half when the term is only punctuation", () => {
    assert.equal(
      generationSearchOrExpression(",,,", ["msg-1"]),
      "outreach_message_id.in.(msg-1)",
    );
  });

  it("returns null when there is nothing to search", () => {
    assert.equal(generationSearchOrExpression("", []), null);
    assert.equal(generationSearchOrExpression("   ", []), null);
  });

  it("ignores empty ids rather than emitting a dangling list item", () => {
    assert.equal(
      generationSearchOrExpression("Mind", ["", "msg-1"]),
      "generated_subject.ilike.%Mind%,outreach_message_id.in.(msg-1)",
    );
  });
});

describe("parseGenerationPage", () => {
  it("defaults to page one at the opening page size", () => {
    assert.deepEqual(parseGenerationPage(undefined, undefined), {
      page: 1,
      pageSize: DEFAULT_GENERATION_PAGE_SIZE,
    });
  });

  it("reads the offered sizes", () => {
    for (const size of GENERATION_PAGE_SIZES) {
      assert.equal(parseGenerationPage("3", String(size)).pageSize, size);
    }
    assert.equal(parseGenerationPage("3", "5").page, 3);
  });

  it("refuses a page size the list does not offer, rather than fetching it", () => {
    // Someone editing the URL to `pageSize=5000` must not become a 5,000-row read.
    assert.equal(parseGenerationPage("1", "5000").pageSize, DEFAULT_GENERATION_PAGE_SIZE);
    assert.equal(parseGenerationPage("1", "0").pageSize, DEFAULT_GENERATION_PAGE_SIZE);
    assert.equal(parseGenerationPage("1", "abc").pageSize, DEFAULT_GENERATION_PAGE_SIZE);
  });

  it("refuses a page number that is not a page", () => {
    assert.equal(parseGenerationPage("-4", "10").page, 1);
    assert.equal(parseGenerationPage("0", "10").page, 1);
    assert.equal(parseGenerationPage("2.7", "10").page, 2);
    assert.equal(parseGenerationPage("nonsense", "10").page, 1);
  });
});

describe("parseModels", () => {
  it("takes one model, or the repeated parameter a multi-select writes", () => {
    assert.deepEqual(parseModels("gemini-2.5-flash"), ["gemini-2.5-flash"]);
    assert.deepEqual(parseModels(["gemini-2.5-flash", "gemini-2.5-pro"]), [
      "gemini-2.5-flash",
      "gemini-2.5-pro",
    ]);
  });

  it("ignores blanks and repeats", () => {
    assert.deepEqual(parseModels(["", "  ", "a", "a"]), ["a"]);
    assert.deepEqual(parseModels(undefined), []);
  });
});

describe("parseEdited", () => {
  it("reads the two states the filter offers", () => {
    assert.equal(parseEdited("yes"), "yes");
    assert.equal(parseEdited("no"), "no");
  });

  it("treats anything else as no filter", () => {
    assert.equal(parseEdited("maybe"), null);
    assert.equal(parseEdited(""), null);
    assert.equal(parseEdited(undefined), null);
  });
});

describe("describeGenerationFilters", () => {
  it("says nothing when nothing is filtering", () => {
    assert.equal(
      describeGenerationFilters({ search: null, models: [], edited: null, sentBy: null }),
      null,
    );
  });

  it("names each filter in the reader's words", () => {
    assert.equal(
      describeGenerationFilters(
        { search: "Sheffield", models: ["gemini-2.5-pro"], edited: "yes", sentBy: "user-1" },
        "Bashir Bobboi",
      ),
      "“Sheffield” · gemini-2.5-pro · edited before sending · generated by Bashir Bobboi",
    );
  });

  it("names the edit state without the word filter", () => {
    assert.equal(
      describeGenerationFilters({ search: null, models: [], edited: "no", sentBy: null }),
      "sent as generated",
    );
  });

  it("falls back when the requester's name is unknown", () => {
    assert.equal(
      describeGenerationFilters({ search: null, models: [], edited: null, sentBy: "user-1" }),
      "generated by one team member",
    );
  });
});

describe("GENERATION_CLIENT_MATCH_LIMIT", () => {
  it("is a bound a query string can carry", () => {
    assert.ok(GENERATION_CLIENT_MATCH_LIMIT > 0 && GENERATION_CLIENT_MATCH_LIMIT <= 100);
  });
});
