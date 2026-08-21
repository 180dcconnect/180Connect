// F192: Remove Tag from Client — real entry point.
//
// Resolves the actor and Supabase client from the actual Next.js request,
// then delegates to the pure, testable logic in remove-tag-core.ts.

import { createClient } from "../supabase/server.ts";
import { getCurrentActor, actorFailureMessage } from "../auth/actor.ts";
import { reportError } from "../error-logging.ts";
import {
  removeTagCore,
  REMOVE_TAG_PERMISSION,
  type RemoveTagResult,
  type OrgTagDeleteClient,
} from "./remove-tag-core.ts";

export type { RemoveTagResult } from "./remove-tag-core.ts";

export async function removeTag(
  organisationId: string,
  tagId: string,
): Promise<RemoveTagResult> {
  const authorization = await getCurrentActor(REMOVE_TAG_PERMISSION, {
    route: "tags.remove",
  });
  if (!authorization.ok) {
    return { ok: false, message: actorFailureMessage(authorization.reason) };
  }

  const supabase = await createClient();
  const client: OrgTagDeleteClient = {
    async deleteOrgTag(orgId, tId) {
      const { error } = await supabase
        .from("org_tags")
        .delete()
        .eq("organisation_id", orgId)
        .eq("tag_id", tId);

      if (error) {
        await reportError(error, {
          operation: "tags.remove",
          actorUserId: authorization.actor.id,
          organisationId: orgId,
          tagId: tId,
        });
        return { ok: false, message: error.message };
      }
      return { ok: true };
    },
  };

  return removeTagCore(organisationId, tagId, client);
}
