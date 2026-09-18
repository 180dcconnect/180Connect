import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { removeTagCore, type OrgTagDeleteClient } from "./remove-tag-core.ts";

function fakeClient(overrides: Partial<OrgTagDeleteClient> = {}) {
  const deleted: { organisationId: string; tagId: string }[] = [];
  const client: OrgTagDeleteClient = {
    async deleteOrgTag(organisationId, tagId) {
      deleted.push({ organisationId, tagId });
      return { ok: true };
    },
    ...overrides,
  };
  return { client, deleted };
}

describe("removeTagCore — successful removal (AC1)", () => {
  it("removes the assignment for the given organisation and tag only", async () => {
    const { client, deleted } = fakeClient();

    const result = await removeTagCore("org-1", "tag-1", client);

    assert.equal(result.ok, true);
    assert.deepEqual(deleted, [{ organisationId: "org-1", tagId: "tag-1" }]);
  });

  it("scopes the delete by organisation and tag together, not tag alone — never touches another client's assignment of the same tag", async () => {
    const { client, deleted } = fakeClient();

    await removeTagCore("org-1", "shared-tag", client);

    assert.equal(deleted.length, 1);
    assert.equal(deleted[0].organisationId, "org-1");
  });
});

describe("removeTagCore — removing an already-removed or nonexistent assignment", () => {
  it("treats a no-op delete (nothing matched) as success, not an error", async () => {
    const { client } = fakeClient({
      async deleteOrgTag() {
        return { ok: true };
      },
    });

    const result = await removeTagCore("org-1", "tag-never-assigned", client);

    assert.equal(result.ok, true);
  });
});

describe("removeTagCore — never deletes the tag itself (AC3)", () => {
  it("only calls deleteOrgTag, nothing tag-table related", async () => {
    const { client, deleted } = fakeClient();

    await removeTagCore("org-1", "tag-1", client);

    assert.equal(deleted.length, 1);
  });
});

describe("removeTagCore — genuine failure", () => {
  it("returns a safe message without leaking raw database error text", async () => {
    const { client } = fakeClient({
      async deleteOrgTag() {
        return {
          ok: false,
          message: "connection to server at internal-db-host:5432 failed",
        };
      },
    });

    const result = await removeTagCore("org-1", "tag-1", client);

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(!result.message.includes("internal-db-host"));
      assert.equal(
        result.message,
        "This tag could not be removed. Please try again later.",
      );
    }
  });
});
