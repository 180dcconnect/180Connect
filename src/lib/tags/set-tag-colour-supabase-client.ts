// F194: Set Tag Colour — the real Supabase write, kept in its own file with
// no import of anything that pulls in "server-only" (i.e.
// src/lib/supabase/server.ts), for the same reason create-tag-core.ts is
// separate from create-tag.ts — Node evaluates every top-level import before
// running anything, so even an unused "server-only" import would break
// `node --test` for this file.

import { reportError } from "../error-logging.ts";
import type { TagColourRpcClient } from "./set-tag-colour-core.ts";

/**
 * The minimal shape of a Supabase client this needs — matches
 * @supabase/supabase-js's real interface for this one call, but is declared
 * locally so a test can pass a fake object without importing the real
 * client library.
 */
export interface TagsRpcClient {
  rpc(
    fn: "set_tag_colour",
    params: { p_tag_id: string; p_colour: string | null },
  ): PromiseLike<{
    data: { id: string; name: string; colour: string | null } | null;
    error: { code?: string | null; message: string } | null;
  }>;
}

/**
 * Builds the real TagColourRpcClient from an already-constructed Supabase
 * client. Pure aside from the Supabase call and reportError — directly
 * testable with a fake TagsRpcClient, no Next.js request context needed.
 */
export function buildSupabaseTagColourClient(
  supabase: TagsRpcClient,
): TagColourRpcClient {
  return {
    async setTagColour(tagId, colour) {
      try {
        const { data, error } = await supabase.rpc("set_tag_colour", {
          p_tag_id: tagId,
          p_colour: colour,
        });

        if (error) {
          await reportError(error, { operation: "tags.set_colour", tagId });
          return { ok: false, code: error.code ?? null, message: error.message };
        }
        // data is guaranteed non-null here: the RPC returns a row on success,
        // and PostgREST populates `error` instead whenever it does not.
        return { ok: true, tag: data! };
      } catch (thrown) {
        // A network failure or similar throws rather than resolving with
        // { error } — caught here and reported with code: null so
        // setTagColourCore never sees a raw thrown value.
        const error =
          thrown instanceof Error ? thrown : new Error(String(thrown));
        await reportError(error, { operation: "tags.set_colour", tagId });
        return { ok: false, code: null, message: error.message };
      }
    },
  };
}
