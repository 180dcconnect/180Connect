// F188: Create Tag — real entry point.
//
// Resolves the actor and Supabase client from the actual Next.js request,
// then delegates to the pure, testable logic in create-tag-core.ts. Fixed
// per code review: this file previously duplicated createTagCore's logic
// instead of importing it, meaning the tested implementation and the one
// actually used by the app could silently diverge.

import { createClient } from "../supabase/server.ts";
import { getCurrentActor, actorFailureMessage } from "../auth/actor.ts";
import { reportError } from "../error-logging.ts";
import {
  createTagCore,
  CREATE_TAG_PERMISSION,
  type CreateTagResult,
  type TagInsertClient,
} from "./create-tag-core.ts";

export type { CreateTagResult } from "./create-tag-core.ts";

export async function createTag(rawName: string): Promise<CreateTagResult> {
  const authorization = await getCurrentActor(CREATE_TAG_PERMISSION, {
    route: "tags.create",
  });
  if (!authorization.ok) {
    return { ok: false, message: actorFailureMessage(authorization.reason) };
  }

  const supabase = await createClient();
  const client: TagInsertClient = {
    async insertTag(name, createdByUserId) {
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
      return { ok: true, tag: data };
    },
  };

  return createTagCore(rawName, authorization.actor.id, client);
}
