import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  assignTagsCore,
  MAX_TAGS_PER_CLIENT,
  type OrgTagInsertClient,
} from "./assign-tag-core.ts";

function fakeClient(overrides: Partial<OrgTagInsertClient> = {}) {
  const inserted: { organisationId: string; tagId: string }[] = [];
  const client: OrgTagInsertClient = {
    async insertOrgTag(organisationId, tagId) {
      inserted.push({ organisationId, tagId });
      return { ok: true };
    },
    async listOrgTagIds() {
      return [];
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

describe("assignTagsCore — per-client tag cap", () => {
  const existing = Array.from(
    { length: MAX_TAGS_PER_CLIENT },
    (_, index) => `tag-existing-${index}`,
  );

  it("refuses a batch that would push the client over the cap, assigning nothing", async () => {
    const { client, inserted } = fakeClient({
      async listOrgTagIds() {
        return ["tag-a", "tag-b", "tag-c", "tag-d", "tag-e", "tag-f", "tag-g"];
      },
    });

    const result = await assignTagsCore(
      "org-1",
      ["tag-new-1", "tag-new-2"],
      "user-1",
      client,
    );

    assert.equal(result.limitReached, true);
    assert.deepEqual(result.assigned, []);
    assert.equal(inserted.length, 0);
  });

  it("allows a batch that lands exactly on the cap", async () => {
    const { client } = fakeClient({
      async listOrgTagIds() {
        return ["tag-a", "tag-b", "tag-c", "tag-d", "tag-e", "tag-f", "tag-g"];
      },
    });

    const result = await assignTagsCore(
      "org-1",
      ["tag-new-1"],
      "user-1",
      client,
    );

    assert.equal(result.limitReached, false);
    assert.deepEqual(result.assigned, ["tag-new-1"]);
  });

  it("does not count already-assigned tags against the cap (AC2)", async () => {
    const { client, inserted } = fakeClient({
      async listOrgTagIds() {
        return existing;
      },
    });

    // Every id in the batch is already assigned: at the cap, this must still
    // be a no-op success, not a limit refusal.
    const result = await assignTagsCore(
      "org-1",
      ["tag-existing-0", "tag-existing-1"],
      "user-1",
      client,
    );

    assert.equal(result.limitReached, false);
    assert.equal(result.alreadyAssigned.length, 2);
    assert.equal(inserted.length, 0);
  });

  it("counts a mixed batch precisely: only genuinely new tags consume slots", async () => {
    const { client, inserted } = fakeClient({
      async listOrgTagIds() {
        return ["tag-a", "tag-b", "tag-c", "tag-d", "tag-e", "tag-f", "tag-g"];
      },
    });

    // 7 existing + 2 new would exceed the cap; 7 existing + 1 new (the other
    // id is already on record) lands exactly on it.
    const result = await assignTagsCore(
      "org-1",
      ["tag-a", "tag-new-1"],
      "user-1",
      client,
    );

    assert.equal(result.limitReached, false);
    assert.deepEqual(result.assigned, ["tag-new-1"]);
    assert.deepEqual(result.alreadyAssigned, ["tag-a"]);
    assert.equal(inserted.length, 1);
  });

  it("treats a full client already at the cap as a limit refusal for new tags", async () => {
    const { client } = fakeClient({
      async listOrgTagIds() {
        return existing;
      },
    });

    const result = await assignTagsCore(
      "org-1",
      ["tag-fresh"],
      "user-1",
      client,
    );

    assert.equal(result.limitReached, true);
    assert.deepEqual(result.assigned, []);
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
            message: "insert or update on table \"org_tags\" violates foreign key constraint",
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
    assert.equal(result.failed[0].message, "This tag no longer exists.");
    assert.deepEqual(result.assigned, ["tag-valid"]);
  });

  it("never surfaces the raw database error text to the caller", async () => {
    const { client } = fakeClient({
      async insertOrgTag() {
        return {
          ok: false,
          code: "08006",
          message: "connection to server was lost, internal host 10.0.4.2",
        };
      },
    });

    const result = await assignTagsCore("org-1", ["tag-1"], "user-1", client);

    assert.equal(result.failed.length, 1);
    assert.ok(!result.failed[0].message.includes("10.0.4.2"));
    assert.equal(
      result.failed[0].message,
      "This tag could not be assigned. Please try again later.",
    );
  });
});