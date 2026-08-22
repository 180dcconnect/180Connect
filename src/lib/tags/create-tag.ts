// F188: Create Tag — real entry point.
//
// createTag itself is intentionally thin: resolve the real actor and
// Supabase client from the Next.js request (both require "server-only",
// which node --test cannot provide, so this function itself can't be
// unit-tested directly), then delegate to two fully-tested pieces:
//   - createTagCore (create-tag-core.ts) — validation and decision logic.
//   - buildSupabaseTagInsertClient (create-tag-supabase-client.ts) — the
//     real Supabase write and error handling.

import { createClient } from "../supabase/server.ts";
import { getCurrentActor, actorFailureMessage } from "../auth/actor.ts";
import {
  createTagCore,
  CREATE_TAG_PERMISSION,
  type CreateTagResult,
} from "./create-tag-core.ts";
import { buildSupabaseTagInsertClient } from "./create-tag-supabase-client.ts";

export type { CreateTagResult } from "./create-tag-core.ts";

export async function createTag(rawName: string): Promise<CreateTagResult> {
  const authorization = await getCurrentActor(CREATE_TAG_PERMISSION, {
    route: "tags.create",
  });
  if (!authorization.ok) {
    return { ok: false, message: actorFailureMessage(authorization.reason) };
  }

  const supabase = await createClient();
  const client = buildSupabaseTagInsertClient(supabase);

  return createTagCore(rawName, authorization.actor.id, client);
}