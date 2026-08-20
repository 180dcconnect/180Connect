// F190: Delete Tag — real entry point.
//
// Resolves the actor and Supabase client from the actual Next.js request,
// then delegates to the pure, testable logic in delete-tag-core.ts.

import { createClient } from "../supabase/server.ts";
import { getCurrentActor, actorFailureMessage } from "../auth/actor.ts";
import { reportError } from "../error-logging.ts";
import {
  deleteTagCore,
  type DeleteTagResult,
  type TagDeleteClient,
} from "./delete-tag-core.ts";

export type { DeleteTagResult } from "./delete-tag-core.ts";

export async function deleteTag(tagId: string): Promise<DeleteTagResult> {
  const authorization = await getCurrentActor("client:edit", {
    route: "tags.delete",
  });
  if (!authorization.ok) {
    return { ok: false, message: actorFailureMessage(authorization.reason) };
  }

  const isAdmin = authorization.actor.role === "admin";

  const supabase = await createClient();
  const client: TagDeleteClient = {
    async countAssignments(id) {
      const { count, error } = await supabase
        .from("org_tags")
        .select("id", { count: "exact", head: true })
        .eq("tag_id", id);

      if (error) {
        await reportError(error, {
          operation: "tags.delete.count_assignments",
          actorUserId: authorization.actor.id,
          tagId: id,
        });
        // Fail safe: if we can't confirm the tag is unused, don't allow
        // the delete to proceed as if it were confirmed unused.
        return 1;
      }
      return count ?? 0;
    },
    async deleteTag(id) {
      const { error } = await supabase.from("tags").delete().eq("id", id);

      if (error) {
        await reportError(error, {
          operation: "tags.delete",
          actorUserId: authorization.actor.id,
          tagId: id,
        });
        return { ok: false, message: error.message };
      }
      return { ok: true };
    },
  };

  return deleteTagCore(tagId, isAdmin, client);
}
