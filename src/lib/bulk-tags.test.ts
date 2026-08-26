// F063 (#65) — Bulk Apply Tags, decision logic in @/lib/bulk-tags.
//
// Tests are named after the acceptance criteria they pin, following the same
// convention as assign-tag.test.ts, and never touch a database — the route is
// the only thing that talks to Supabase.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  MAX_BULK_TAG_CLIENTS,
  MAX_BULK_TAG_TAGS,
  buildBulkTagRows,
  bulkTagsInsertFailure,
  bulkTagsSummary,
} from "./bulk-tags.ts";

describe("buildBulkTagRows", () => {
  it("AC1: applies one tag to many clients — one row per client", () => {
    const rows = buildBulkTagRows(["org-1", "org-2"], ["tag-a"], "user-1");
    assert.deepEqual(rows, [
      { organisation_id: "org-1", tag_id: "tag-a", added_by_user_id: "user-1" },
      { organisation_id: "org-2", tag_id: "tag-a", added_by_user_id: "user-1" },
    ]);
  });

  it("AC1: applies multiple tags to multiple clients — the full cross product", () => {
    const rows = buildBulkTagRows(["org-1", "org-2"], ["tag-a", "tag-b"], "user-1");
    assert.equal(rows.length, 4);
    for (const orgId of ["org-1", "org-2"]) {
      for (const tagId of ["tag-a", "tag-b"]) {
        assert.ok(
          rows.some(
            (row) =>
              row.organisation_id === orgId && row.tag_id === tagId && row.added_by_user_id === "user-1",
          ),
          `missing pair ${orgId} x ${tagId}`,
        );
      }
    }
  });

  it("attributes every row to the caller — RLS requires added_by_user_id = auth.uid()", () => {
    const rows = buildBulkTagRows(["org-1"], ["tag-a", "tag-b"], "caller-9");
    assert.ok(rows.every((row) => row.added_by_user_id === "caller-9"));
  });

  it("dedupes clients and tags so a hand-built request cannot inflate the payload", () => {
    const rows = buildBulkTagRows(["org-1", "org-1"], ["tag-a", "tag-a"], "user-1");
    assert.deepEqual(rows, [{ organisation_id: "org-1", tag_id: "tag-a", added_by_user_id: "user-1" }]);
  });

  it("empty selection produces no rows", () => {
    assert.deepEqual(buildBulkTagRows([], ["tag-a"], "user-1"), []);
    assert.deepEqual(buildBulkTagRows(["org-1"], [], "user-1"), []);
  });
});

describe("bulkTagsSummary (AC3)", () => {
  it("reports how many clients were tagged when every selected client got a tag", () => {
    assert.equal(
      bulkTagsSummary({ requested: 3, tagged: 3, unchanged: 0 }),
      "Tags applied to 3 clients.",
    );
    assert.equal(
      bulkTagsSummary({ requested: 1, tagged: 1, unchanged: 0 }),
      "Tags applied to 1 client.",
    );
  });

  it("counts clients that already had every chosen tag as skipped, not failures (AC2)", () => {
    assert.equal(
      bulkTagsSummary({ requested: 4, tagged: 3, unchanged: 1 }),
      "Tags applied to 3 of 4 selected clients. The other client already has every selected tag.",
    );
    assert.equal(
      bulkTagsSummary({ requested: 5, tagged: 2, unchanged: 3 }),
      "Tags applied to 2 of 5 selected clients. The other 3 clients already have every selected tag.",
    );
  });

  it("says so plainly when nothing changed because everyone was already tagged", () => {
    assert.match(
      bulkTagsSummary({ requested: 2, tagged: 0, unchanged: 2 }),
      /already have all of them/,
    );
    assert.match(
      bulkTagsSummary({ requested: 1, tagged: 0, unchanged: 1 }),
      /already has every selected tag/,
    );
  });
});

describe("bulkTagsInsertFailure", () => {
  it("maps an RLS refusal onto a permission sentence and a 403", () => {
    const failure = bulkTagsInsertFailure({ code: "42501" });
    assert.equal(failure.status, 403);
    assert.doesNotMatch(failure.error, /policy|row-level|42501/i);
  });

  it("maps a missing client or tag onto a refresh-and-retry sentence and a 404", () => {
    const failure = bulkTagsInsertFailure({ code: "23503" });
    assert.equal(failure.status, 404);
    assert.match(failure.error, /no longer exists/);
  });

  it("never surfaces raw Postgres detail for unknown codes (DoD)", () => {
    const failure = bulkTagsInsertFailure({
      code: "XX000",
      message: 'relation "org_tags" does not exist at character 13',
    });
    assert.equal(failure.status, 500);
    assert.doesNotMatch(failure.error, /org_tags|character|XX000/);
  });
});

describe("limits", () => {
  it("caps clients at the same ceiling as the other bulk actions", () => {
    assert.equal(MAX_BULK_TAG_CLIENTS, 500);
  });

  it("bounds how many distinct tags one call may carry", () => {
    assert.ok(Number.isInteger(MAX_BULK_TAG_TAGS) && MAX_BULK_TAG_TAGS >= 1);
  });
});
