// F191: Assign Tag to Client — real entry point.
//
// Resolves the actor and Supabase client from the actual Next.js request,
// then delegates to the pure, testable logic in assign-tag-core.ts.

import { createClient } from "../supabase/server.ts";
import { getCurrentActor, actorFailureMessage } from "../auth/actor.ts";
import { reportError } from "../error-logging.ts";
import {
  assignTagsCore,
  ASSIGN_TAG_PERMISSION,
  MAX_TAGS_PER_CLIENT,
  type AssignTagsResult,
  type OrgTagInsertClient,
} from "./assign-tag-core.ts";

export type AssignTagsOutcome =
  | { ok: true; result: AssignTagsResult }
  | { ok: false; message: string };

export async function assignTags(
  organisationId: string,
  tagIds: string[],
): Promise<AssignTagsOutcome> {
  const authorization = await getCurrentActor(ASSIGN_TAG_PERMISSION, {
    route: "tags.assign",
  });
  if (!authorization.ok) {
    return { ok: false, message: actorFailureMessage(authorization.reason) };
  }

  if (tagIds.length === 0) {
    return { ok: false, message: "Select at least one tag to assign." };
  }

  const supabase = await createClient();
  const client: OrgTagInsertClient = {
    async insertOrgTag(orgId, tagId, addedByUserId) {
      const { error } = await supabase
        .from("org_tags")
        .insert({
          organisation_id: orgId,
          tag_id: tagId,
          added_by_user_id: addedByUserId,
        });

      if (error) {
        // 23505 (already assigned) is expected and handled by the core as
        // a no-op — only report genuinely unexpected failures.
        if (error.code !== "23505") {
          await reportError(error, {
            operation: "tags.assign",
            actorUserId: addedByUserId,
            organisationId: orgId,
            tagId,
          });
        }
        return { ok: false, code: error.code ?? null, message: error.message };
      }
      return { ok: true };
    },
    async listOrgTagIds(orgId) {
      const { data, error } = await supabase
        .from("org_tags")
        .select("tag_id")
        .eq("organisation_id", orgId);

      if (error) {
        await reportError(error, {
          operation: "tags.assign.list",
          actorUserId: authorization.actor.id,
          organisationId: orgId,
        });
        // Degrade to "nothing assigned" rather than fail the batch: a read
        // failure must not silently refuse an assignment, and the picker's
        // own cap check is the primary guard anyway.
        return [];
      }
      return (data ?? []).map((row) => row.tag_id);
    },
  };

  const result = await assignTagsCore(
    organisationId,
    tagIds,
    authorization.actor.id,
    client,
  );

  if (result.limitReached) {
    return {
      ok: false,
      message: `A client can have at most ${MAX_TAGS_PER_CLIENT} tags. Remove one before adding more.`,
    };
  }

  return { ok: true, result };
}