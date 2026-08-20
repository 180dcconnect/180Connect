// F189: Edit Tag — real entry point.
//
// Resolves the actor and Supabase client from the actual Next.js request,
// then delegates to the pure, testable logic in edit-tag-core.ts.

import { createClient } from "../supabase/server.ts";
import { getCurrentActor, actorFailureMessage } from "../auth/actor.ts";
import { reportError } from "../error-logging.ts";
import {
  editTagCore,
  type EditTagResult,
  type TagUpdateClient,
} from "./edit-tag-core.ts";

export type { EditTagResult } from "./edit-tag-core.ts";

export async function editTag(
  tagId: string,
  newName: string,
): Promise<EditTagResult> {
  const authorization = await getCurrentActor("client:edit", {
    route: "tags.edit",
  });
  if (!authorization.ok) {
    return { ok: false, message: actorFailureMessage(authorization.reason) };
  }

  const isAdmin = authorization.actor.role === "admin";

  const supabase = await createClient();
  const client: TagUpdateClient = {
    async updateTagName(id, name) {
      const { data, error } = await supabase
        .from("tags")
        .update({ name })
        .eq("id", id)
        .select("id, name")
        .single();

      if (error) {
        await reportError(error, {
          operation: "tags.edit",
          actorUserId: authorization.actor.id,
          tagId: id,
        });
        return { ok: false, code: error.code ?? null, message: error.message };
      }
      return { ok: true, tag: data };
    },
  };

  return editTagCore(tagId, newName, isAdmin, client);
}
