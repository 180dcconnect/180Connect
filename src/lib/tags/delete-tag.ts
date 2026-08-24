// F190: Delete Tag — real entry point.
//
// Resolves the actor and Supabase client from the actual Next.js request,
// then delegates to the pure, testable logic in delete-tag-core.ts. The
// database call is the delete_unused_tag RPC, which enforces both the
// admin-only rule and the "never delete an in-use tag" rule atomically
// inside one transaction (see
// supabase/migrations/20260830000000_create_delete_unused_tag_rpc.sql).

import { createClient } from "../supabase/server.ts";
import { getCurrentActor, actorFailureMessage } from "../auth/actor.ts";
import { reportError } from "../error-logging.ts";
import {
  deleteTagCore,
  type DeleteTagResult,
  type TagDeleteClient,
  type TagDeleteOutcome,
} from "./delete-tag-core.ts";

export type { DeleteTagResult } from "./delete-tag-core.ts";

function outcomeFromRpc(
  data: unknown,
): TagDeleteOutcome {
  if (
    data &&
    typeof data === "object" &&
    "status" in data &&
    typeof (data as { status: unknown }).status === "string"
  ) {
    const raw = data as { status: string; assigned_count?: number };
    switch (raw.status) {
      case "deleted":
        return { status: "deleted" };
      case "not_found":
        return { status: "not_found" };
      case "forbidden":
        return { status: "forbidden" };
      case "in_use":
        return {
          status: "in_use",
          assignedCount:
            typeof raw.assigned_count === "number" ? raw.assigned_count : 0,
        };
    }
  }
  // An unexpected shape is a failure of the check itself, not evidence the
  // tag is unused.
  return { status: "check_failed" };
}

export async function deleteTag(tagId: string): Promise<DeleteTagResult> {
  const authorization = await getCurrentActor("tags:manage", {
    route: "tags.delete",
  });
  if (!authorization.ok) {
    return { ok: false, message: actorFailureMessage(authorization.reason) };
  }

  const isAdmin = authorization.actor.role === "admin";

  if (!isAdmin) {
    // Skip the RPC entirely for non-admins; delete_unused_tag re-checks
    // server-side regardless (SECURITY DEFINER bypasses RLS, so it cannot
    // rely on policies).
    return { ok: false, message: "Only an admin can delete a shared tag." };
  }

  const supabase = await createClient();
  const client: TagDeleteClient = {
    async deleteUnusedTag(id) {
      const { data, error } = await supabase.rpc("delete_unused_tag", {
        p_tag_id: id,
      });

      if (error) {
        await reportError(error, {
          operation: "tags.delete.unused_tag_rpc",
          actorUserId: authorization.actor.id,
          tagId: id,
        });
        return { status: "check_failed" };
      }

      return outcomeFromRpc(data);
    },
  };

  return deleteTagCore(tagId, isAdmin, client);
}
