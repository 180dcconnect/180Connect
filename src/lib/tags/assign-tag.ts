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
  };

  const result = await assignTagsCore(
    organisationId,
    tagIds,
    authorization.actor.id,
    client,
  );

  return { ok: true, result };
}