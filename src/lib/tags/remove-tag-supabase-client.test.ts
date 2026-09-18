import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildSupabaseOrgTagDeleteClient,
  type OrgTagSupabase,
} from "./remove-tag-supabase-client.ts";
import { removeTagCore } from "./remove-tag-core.ts";

type Recorded = { table: string; filters: [string, string][] };

function fakeSupabase(
  result: { error: { message: string } | null },
): { client: OrgTagSupabase; calls: Recorded[] } {
  const calls: Recorded[] = [];
  const client: OrgTagSupabase = {
    from(table) {
      const filters: [string, string][] = [];
      return {
        delete() {
          return {
            eq(column, value) {
              filters.push([column, value]);
              return {
                eq(innerColumn, innerValue) {
                  filters.push([innerColumn, innerValue]);
                  calls.push({ table, filters });
                  return Promise.resolve(result);
                },
              };
            },
          };
        },
      };
    },
  };
  return { client, calls };
}

describe("buildSupabaseOrgTagDeleteClient — the real Supabase delete (AC1)", () => {
  it("scopes the delete to org_tags by organisation_id AND tag_id together", async () => {
    const { client, calls } = fakeSupabase({ error: null });

    const deleteClient = buildSupabaseOrgTagDeleteClient(client, reportNever, "user-1");
    const result = await deleteClient.deleteOrgTag("org-1", "tag-1");

    assert.equal(result.ok, true);
    assert.deepEqual(calls, [
      {
        table: "org_tags",
        filters: [
          ["organisation_id", "org-1"],
          ["tag_id", "tag-1"],
        ],
      },
    ]);
  });

  it("never deletes without both filters — a tag-only delete is impossible", async () => {
    const { client, calls } = fakeSupabase({ error: null });

    const deleteClient = buildSupabaseOrgTagDeleteClient(client, reportNever, "user-1");
    await deleteClient.deleteOrgTag("org-2", "shared-tag");

    assert.equal(calls.length, 1);
    const columns = calls[0].filters.map(([column]) => column);
    assert.ok(columns.includes("organisation_id"));
    assert.ok(columns.includes("tag_id"));
  });
});

describe("buildSupabaseOrgTagDeleteClient — error reporting", () => {
  it("reports the failure with full context and hides the raw message from callers", async () => {
    const reported: unknown[] = [];
    const reportError = async (error: unknown) => {
      reported.push(error);
    };

    const { client } = fakeSupabase({
      error: { message: "connection to db.internal:5432 failed" },
    });

    const deleteClient = buildSupabaseOrgTagDeleteClient(client, reportError, "user-1");
    // Compose exactly as production does (remove-tag.ts): core wraps the
    // real Supabase client, and it — not the wrapper — sanitises messages.
    const result = await removeTagCore("org-1", "tag-1", deleteClient);

    assert.equal(result.ok, false);
    // The raw failure reached the error log with full context...
    assert.equal(reported.length, 1);
    // ...but the caller never sees the raw database error text.
    assert.ok(!JSON.stringify(result).includes("db.internal"));
  });
});

async function reportNever(): Promise<void> {
  throw new Error("reportError should not have been called");
}
