// F192: Remove Tag from Client — real entry point.
//
// Resolves the actor and Supabase client from the actual Next.js request,
// then delegates to the pure, testable logic in remove-tag-core.ts. The
// real Supabase delete lives in remove-tag-supabase-client.ts so its query
// shape is unit-testable.

import { createClient } from "../supabase/server.ts";
import { getCurrentActor, actorFailureMessage } from "../auth/actor.ts";
import { reportError } from "../error-logging.ts";
import {
  removeTagCore,
  REMOVE_TAG_PERMISSION,
  type RemoveTagResult,
} from "./remove-tag-core.ts";
import { buildSupabaseOrgTagDeleteClient } from "./remove-tag-supabase-client.ts";

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
  const client = buildSupabaseOrgTagDeleteClient(
    supabase,
    reportError,
    authorization.actor.id,
  );

  return removeTagCore(organisationId, tagId, client);
}
