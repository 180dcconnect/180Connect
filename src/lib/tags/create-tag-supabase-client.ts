// F188: the real Supabase-write logic for creating a tag, kept in its own
// file with no import of anything that pulls in "server-only" (i.e.
// src/lib/supabase/server.ts), for the same reason create-tag-core.ts is
// separate from create-tag.ts — Node evaluates every top-level import
// before running anything, so even an unused "server-only" import would
// break `node --test` for this file.

import { reportError } from "../error-logging.ts";
import type { TagInsertClient } from "./create-tag-core.ts";

/**
 * The minimal shape of a Supabase client this needs — matches
 * @supabase/supabase-js's real interface for this one call, but is
 * declared locally so a test can pass a fake object without importing the
 * real client library.
 */
export interface TagsTableClient {
  from(table: "tags"): {
    insert(row: { name: string; created_by_user_id: string }): {
      select(columns: string): {
        // PromiseLike, not Promise: the real Supabase query builder is
        // thenable but isn't a literal Promise (no .catch/.finally), and a
        // fake async function's real Promise still satisfies PromiseLike,
        // so this accepts both.
        single(): PromiseLike<{
          data: { id: string; name: string } | null;
          error: { code?: string | null; message: string } | null;
        }>;
      };
    };
  };
}

/**
 * Builds the real TagInsertClient from an already-constructed Supabase
 * client. Pure aside from the Supabase call and reportError — no
 * "server-only" import here, so this is directly testable with a fake
 * TagsTableClient, no Next.js request context needed.
 */
export function buildSupabaseTagInsertClient(
  supabase: TagsTableClient,
): TagInsertClient {
  return {
    async insertTag(name, createdByUserId) {
      try {
        const { data, error } = await supabase
          .from("tags")
          .insert({ name, created_by_user_id: createdByUserId })
          .select("id, name")
          .single();

        if (error) {
          await reportError(error, {
            operation: "tags.create",
            actorUserId: createdByUserId,
          });
          return { ok: false, code: error.code ?? null, message: error.message };
        }
        // data is guaranteed non-null here: .single() either returns a row
        // or populates `error`, never both null.
        return { ok: true, tag: data! };
      } catch (thrown) {
        // Review fix: a network failure or similar throws rather than
        // resolving with { error }, and without this the caller would get
        // an unhandled exception instead of the normal safe failure
        // message. Caught here, logged the same way as a resolved error,
        // and reported with the same safe code: null so createTagCore
        // never sees a raw thrown value.
        const error =
          thrown instanceof Error ? thrown : new Error(String(thrown));
        await reportError(error, {
          operation: "tags.create",
          actorUserId: createdByUserId,
        });
        return { ok: false, code: null, message: error.message };
      }
    },
  };
}
