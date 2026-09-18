// F194: Set Tag Colour — real entry point.
//
// Resolves the actor and Supabase client from the actual Next.js request
// (both require "server-only", which node --test cannot provide, so this
// function itself can't be unit-tested directly), then delegates to two
// fully-tested pieces:
//   - setTagColourCore (set-tag-colour-core.ts) — validation/decision logic.
//   - buildSupabaseTagColourClient (set-tag-colour-supabase-client.ts) —
//     the real RPC write and error handling.

import { createClient } from "../supabase/server.ts";
import { getCurrentActor, actorFailureMessage } from "../auth/actor.ts";
import {
  setTagColourCore,
  SET_TAG_COLOUR_PERMISSION,
  type SetTagColourResult,
} from "./set-tag-colour-core.ts";
import { buildSupabaseTagColourClient } from "./set-tag-colour-supabase-client.ts";

export type { SetTagColourResult } from "./set-tag-colour-core.ts";

export async function setTagColour(
  tagId: string,
  rawColour: unknown,
): Promise<SetTagColourResult> {
  const authorization = await getCurrentActor(SET_TAG_COLOUR_PERMISSION, {
    route: "tags.set_colour",
  });
  if (!authorization.ok) {
    return { ok: false, message: actorFailureMessage(authorization.reason) };
  }

  const supabase = await createClient();
  const client = buildSupabaseTagColourClient(supabase);

  return setTagColourCore(tagId, rawColour, client);
}
