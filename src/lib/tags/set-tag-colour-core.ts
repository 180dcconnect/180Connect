// F194: Set Tag Colour — pure decision logic.
//
// Same reasoning as create-tag-core.ts: no import of anything that pulls in
// "server-only", so this is directly unit-testable without a real Next.js
// request context.
//
// The write goes through the set_tag_colour SECURITY DEFINER RPC rather than
// a direct UPDATE (see 20260829000000_tag_colour_check_and_set_colour_rpc.sql
// for why): Postgres RLS cannot scope a policy to a column, so letting CAMs
// UPDATE the row would also have opened renames to them at the DB layer.
//
// AC3: recolouring is CAM/admin work; the entry point gates on tags:manage
// and the RPC re-checks app.can_write() inside, so a viewer is refused at
// both layers.

import { parseTagColour } from "./tag-colours.ts";

export type SetTagColourResult =
  | { ok: true; tag: { id: string; name: string; colour: string | null } }
  | { ok: false; message: string };

export interface TagColourRpcClient {
  setTagColour(
    tagId: string,
    colour: string | null,
  ): Promise<
    | { ok: true; tag: { id: string; name: string; colour: string | null } }
    | { ok: false; code: string | null; message: string }
  >;
}

export const SET_TAG_COLOUR_PERMISSION = "tags:manage" as const;

export async function setTagColourCore(
  tagId: string,
  rawColour: unknown,
  client: TagColourRpcClient,
): Promise<SetTagColourResult> {
  // Absent means "clear" — an explicit, supported outcome, not a default.
  const parsed = parseTagColour(rawColour);
  if (!parsed.valid) {
    return { ok: false, message: parsed.message };
  }

  const result = await client.setTagColour(tagId, parsed.colour);

  if (!result.ok) {
    if (result.code === "P0002") {
      return { ok: false, message: "This tag no longer exists." };
    }
    if (result.code === "42501") {
      // Reached only if RLS/the RPC refuses a caller the app gate already
      // let through — e.g. deactivated mid-session. Same safe refusal shape.
      return {
        ok: false,
        message: "You do not have permission to change tag colours.",
      };
    }
    return {
      ok: false,
      message: "The colour could not be saved. Please try again later.",
    };
  }

  return { ok: true, tag: result.tag };
}
