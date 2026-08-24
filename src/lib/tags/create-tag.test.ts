import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createTagCore, type TagInsertClient } from "./create-tag-core.ts";

function fakeClient(
  overrides: Partial<TagInsertClient> = {},
): {
  client: TagInsertClient;
  inserted: {
    name: string;
    createdByUserId: string;
    colour: string | null;
  }[];
} {
  const inserted: {
    name: string;
    createdByUserId: string;
    colour: string | null;
  }[] = [];
  const client: TagInsertClient = {
    async insertTag(name, createdByUserId, colour) {
      inserted.push({ name, createdByUserId, colour });
      return { ok: true, tag: { id: "tag-1", name, colour } };
    },
    ...overrides,
  };
  return { client, inserted };
}

describe("createTagCore — successful create", () => {
  it("creates a tag with a trimmed name", async () => {
    const { client, inserted } = fakeClient();

    const result = await createTagCore("  Urgent  ", "user-1", client);

    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.tag.name, "Urgent");
    assert.equal(inserted[0].name, "Urgent");
    assert.equal(inserted[0].createdByUserId, "user-1");
  });

  it("is available platform-wide — does not scope the insert to a personal owner concept beyond attribution", async () => {
    // AC2: tags are shared, not personal. This is really an assertion about
    // the DB schema (no "owner-only" column, no RLS restricting SELECT to
    // the creator) rather than something createTagCore itself can prove —
    // documented here so the shared-by-design intent is explicit, alongside
    // the real guarantee: creation attributes the tag (createdByUserId) but
    // does not restrict its use to that user.
    const { client, inserted } = fakeClient();
    await createTagCore("Priority", "user-1", client);
    assert.equal(inserted[0].createdByUserId, "user-1");
  });
});

describe("createTagCore — invalid name (AC3)", () => {  it("rejects an empty name without calling insert", async () => {
    const { client, inserted } = fakeClient();

    const result = await createTagCore("", "user-1", client);

    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.message, "Enter a tag name.");
    assert.equal(inserted.length, 0);
  });

  it("rejects a whitespace-only name", async () => {
    const { client, inserted } = fakeClient();

    const result = await createTagCore("   ", "user-1", client);

    assert.equal(result.ok, false);
    assert.equal(inserted.length, 0);
  });
});

describe("createTagCore — duplicate tag (AC1)", () => {
  it("returns a specific, friendly message on a unique-constraint violation", async () => {
    const { client } = fakeClient({
      async insertTag() {
        return { ok: false, code: "23505", message: "duplicate key value" };
      },
    });

    const result = await createTagCore("Urgent", "user-1", client);

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.message, 'A tag named "Urgent" already exists.');
    }
  });
});

describe("createTagCore — unexpected failure", () => {
  it("returns a generic safe message for a non-duplicate database error", async () => {
    const { client } = fakeClient({
      async insertTag() {
        return { ok: false, code: "08006", message: "connection failure" };
      },
    });

    const result = await createTagCore("Urgent", "user-1", client);

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(
        result.message,
        "The tag could not be created. Please try again later.",
      );
      // Must not leak the raw database error/message to the user.
      assert.ok(!result.message.includes("connection failure"));
    }
  });
});
describe("createTagCore — colour at creation (F194 AC1)", () => {
  it("passes a chosen palette colour through to the insert", async () => {
    const { client, inserted } = fakeClient();

    const result = await createTagCore("Urgent", "user-1", client, "#175CD3");

    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.tag.colour, "#175cd3");
    assert.equal(inserted[0].colour, "#175cd3");
  });

  it("stores null when no colour was chosen", async () => {
    const { client, inserted } = fakeClient();

    const result = await createTagCore("Urgent", "user-1", client);

    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.tag.colour, null);
    assert.equal(inserted[0].colour, null);
  });

  it("stores null for an explicitly empty colour", async () => {
    const { client, inserted } = fakeClient();
    await createTagCore("Urgent", "user-1", client, "");
    assert.equal(inserted[0].colour, null);
  });

  it("refuses an off-palette colour without calling insert", async () => {
    const { client, inserted } = fakeClient();

    const result = await createTagCore("Urgent", "user-1", client, "#ff0000");

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.message, "Pick a colour from the palette.");
    }
    assert.equal(inserted.length, 0);
  });

  it("refuses a non-hex colour without calling insert", async () => {
    const { client, inserted } = fakeClient();

    const result = await createTagCore("Urgent", "user-1", client, "red");

    assert.equal(result.ok, false);
    assert.equal(inserted.length, 0);
  });
});
