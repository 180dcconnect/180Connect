import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { assignTagsCore, type OrgTagInsertClient } from "./assign-tag-core.ts";

function fakeClient(overrides: Partial<OrgTagInsertClient> = {}) {
  const inserted: { organisationId: string; tagId: string }[] = [];
  const client: OrgTagInsertClient = {
    async insertOrgTag(organisationId, tagId) {
      inserted.push({ organisationId, tagId });
      return { ok: true };
    },
    ...overrides,
  };
  return { client, inserted };
}

describe("assignTagsCore — successful assignment (AC1)", () => {
  it("assigns a single tag", async () => {
    const { client, inserted } = fakeClient();

    const result = await assignTagsCore("org-1", ["tag-1"], "user-1", client);

    assert.deepEqual(result.assigned, ["tag-1"]);
    assert.equal(inserted.length, 1);
  });

  it("assigns multiple tags in one call", async () => {
    const { client, inserted } = fakeClient();

    const result = await assignTagsCore(
      "org-1",
      ["tag-1", "tag-2", "tag-3"],
      "user-1",
      client,
    );

    assert.deepEqual(result.assigned, ["tag-1", "tag-2", "tag-3"]);
    assert.equal(inserted.length, 3);
  });

  it("deduplicates repeated tag ids within the same call", async () => {
    const { client, inserted } = fakeClient();

    const result = await assignTagsCore(
      "org-1",
      ["tag-1", "tag-1", "tag-2"],
      "user-1",
      client,
    );

    assert.deepEqual(result.assigned, ["tag-1", "tag-2"]);
    assert.equal(inserted.length, 2);
  });
});

describe("assignTagsCore — duplicate assignment is a no-op (AC2)", () => {
  it("does not treat an already-assigned tag as a failure", async () => {
    const { client } = fakeClient({
      async insertOrgTag() {
        return { ok: false, code: "23505", message: "duplicate key value" };
      },
    });

    const result = await assignTagsCore("org-1", ["tag-1"], "user-1", client);

    assert.deepEqual(result.alreadyAssigned, ["tag-1"]);
    assert.deepEqual(result.assigned, []);
    assert.deepEqual(result.failed, []);
  });

  it("handles a mix of new and already-assigned tags in one call", async () => {
    const { client } = fakeClient({
      async insertOrgTag(_org, tagId) {
        if (tagId === "tag-already") {
          return { ok: false, code: "23505", message: "duplicate key value" };
        }
        return { ok: true };
      },
    });

    const result = await assignTagsCore(
      "org-1",
      ["tag-new", "tag-already"],
      "user-1",
      client,
    );

    assert.deepEqual(result.assigned, ["tag-new"]);
    assert.deepEqual(result.alreadyAssigned, ["tag-already"]);
  });
});

describe("assignTagsCore — invalid tag", () => {
  it("reports a genuine failure without aborting the rest of the batch", async () => {
    const { client } = fakeClient({
      async insertOrgTag(_org, tagId) {
        if (tagId === "tag-invalid") {
          return {
            ok: false,
            code: "23503",
            message: "foreign key violation",
          };
        }
        return { ok: true };
      },
    });

    const result = await assignTagsCore(
      "org-1",
      ["tag-invalid", "tag-valid"],
      "user-1",
      client,
    );

    assert.equal(result.failed.length, 1);
    assert.equal(result.failed[0].tagId, "tag-invalid");
    assert.deepEqual(result.assigned, ["tag-valid"]);
  });
});