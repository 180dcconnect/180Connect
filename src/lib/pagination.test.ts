import assert from "node:assert/strict";
import { test } from "node:test";

import {
  PAGE_SIZE_CHOICES,
  pageSummary,
  paginate,
  pagingIsUseful,
} from "./pagination.ts";

const ROWS = Array.from({ length: 13 }, (_, index) => `row-${index + 1}`);

test("the window reports the position it is showing", () => {
  const first = paginate(ROWS, 1, 10);
  assert.deepEqual(first.items, ROWS.slice(0, 10));
  assert.equal(first.from, 1);
  assert.equal(first.to, 10);
  assert.equal(first.totalItems, 13);
  assert.equal(first.totalPages, 2);

  const second = paginate(ROWS, 2, 10);
  assert.deepEqual(second.items, ["row-11", "row-12", "row-13"]);
  assert.equal(second.from, 11);
  assert.equal(second.to, 13);
});

test("a page past the end resolves to the last real page, not to nothing", () => {
  // The reader was on page 3 when the rows on it were decided away. Answering
  // the stale number with an empty list reads as a broken list.
  const slice = paginate(ROWS, 3, 10);
  assert.equal(slice.page, 2);
  assert.equal(slice.from, 11);
  assert.deepEqual(slice.items, ["row-11", "row-12", "row-13"]);
});

test("an empty list is page 1 of 1, showing nothing", () => {
  const slice = paginate([], 1, 10);
  assert.deepEqual(slice.items, []);
  assert.equal(slice.page, 1);
  assert.equal(slice.totalPages, 1);
  assert.equal(slice.from, 0);
  assert.equal(slice.to, 0);
});

test("an exact multiple does not leave a trailing empty page", () => {
  const slice = paginate(ROWS.slice(0, 10), 1, 10);
  assert.equal(slice.totalPages, 1);
  assert.equal(slice.page, 1);
  assert.equal(slice.to, 10);
});

test("the last page is partial and the count says so", () => {
  const slice = paginate(ROWS, 3, 5);
  assert.deepEqual(slice.items, ["row-11", "row-12", "row-13"]);
  assert.equal(slice.totalPages, 3);
  assert.equal(slice.from, 11);
  assert.equal(slice.to, 13);
});

test("nonsense input is clamped rather than trusted", () => {
  // Page and size reach this from a URL and from local state; neither is a
  // reason to print "showing NaN to NaN".
  for (const bad of [0, -4, 1.7, Number.NaN]) {
    const slice = paginate(ROWS, bad, 10);
    assert.ok(slice.page >= 1, `page ${bad} → ${slice.page}`);
    assert.ok(slice.items.length > 0);
  }
  const zeroSize = paginate(ROWS, 1, 0);
  assert.equal(zeroSize.pageSize, 1);
  assert.deepEqual(zeroSize.items, ["row-1"]);
  assert.equal(zeroSize.totalPages, 13);

  const negativeSize = paginate(ROWS, 1, -10);
  assert.equal(negativeSize.pageSize, 1);
});

test("pageSummary answers the same questions from a count alone", () => {
  // The database-paged list never holds the rows it is not showing, so it must be
  // able to get the identical reading from a number — the count line it prints is
  // the same one the in-memory lists print.
  assert.deepEqual(pageSummary(13, 2, 10), {
    page: 2,
    pageSize: 10,
    totalItems: 13,
    totalPages: 2,
    from: 11,
    to: 13,
  });
  assert.deepEqual(paginate(ROWS, 2, 10).items, ["row-11", "row-12", "row-13"]);
});

test("pagingIsUseful hides the control when everything fits", () => {
  assert.equal(pagingIsUseful(0), false);
  assert.equal(pagingIsUseful(3), false);
  assert.equal(pagingIsUseful(5), false, "5 on a 5-per-page list is one page");
  assert.equal(pagingIsUseful(6), true);
  assert.equal(pagingIsUseful(13), true);
  // A caller offering only 10s has nothing to page until row 11.
  assert.equal(pagingIsUseful(9, [10, 20]), false);
  assert.equal(pagingIsUseful(11, [10, 20]), true);
});

test("the offered sizes are the smallest-first client list ones", () => {
  assert.deepEqual([...PAGE_SIZE_CHOICES], [5, 10, 15, 20]);
});
