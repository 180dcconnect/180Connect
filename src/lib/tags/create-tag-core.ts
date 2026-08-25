// F188/F194: Create Tag — pure decision logic.
//
// Deliberately has no import of anything that pulls in "server-only" (i.e.
// src/lib/supabase/server.ts), for the same reason admin-client-factory.ts
// exists: "server-only" throws outside a real Next.js request, and Node
// evaluates every import at module load time, so even an unused import
// would break `node --test` for this file. The real Next.js entry point
// (create-tag.ts) imports this module and supplies the real client.

import { parseTagColour } from "./tag-colours.ts";

export type CreateTagResult =
  | { ok: true; tag: { id: string; name: string; colour: string | null } }
  | { ok: false; message: string };

/** The one Supabase operation this needs, behind an interface — same
 * reasoning as OrganisationWriteStore: the validation/decision logic here
 * is testable without a real database or Next.js request context. */
export interface TagInsertClient {
  insertTag(
    name: string,
    createdByUserId: string,
    colour: string | null,
  ): Promise<
    | { ok: true; tag: { id: string; name: string; colour: string | null } }
    | { ok: false; code: string | null; message: string }
  >;
}

/**
 * Tags have their own permission rather than borrowing "client:edit": the
 * shared tag taxonomy is a curation concern, not a client-data write, and
 * F188-F192 (create/assign/remove) all gate on this single permission. The
 * DB-level counterpart is app.can_write() on public.tags / public.org_tags,
 * which covers the same admin+CAM population.
 */
export const CREATE_TAG_PERMISSION = "tags:manage" as const;

/**
 * Pure decision logic: validate, attempt the insert, translate the result
 * into a user-facing outcome. No Next.js request context, no cookies — just
 * the actor id and an injected client, so this is directly unit-testable.
 */
export async function createTagCore(
  rawName: string,
  actorId: string,
  client: TagInsertClient,
  rawColour?: unknown,
): Promise<CreateTagResult> {
  // AC3: empty name is blocked with a clear message. Trimmed first so
  // whitespace-only input ("   ") is treated the same as truly empty.
  const name = rawName.trim();
  if (name === "") {
    return { ok: false, message: "Enter a tag name." };
  }

  // F194 AC1: an optional palette colour at creation. Validated before the
  // insert so an off-palette value is refused with a clear message rather
  // than silently created colourless (or tripping the DB constraint).
  const parsedColour = parseTagColour(rawColour);
  if (!parsedColour.valid) {
    return { ok: false, message: parsedColour.message };
  }

  const result = await client.insertTag(name, actorId, parsedColour.colour);

  if (!result.ok) {
    // Postgres unique_violation. The DB's lower(name) index is the real
    // guard (AC1); this branch turns that into the specific, friendly
    // message rather than a generic "could not be created" fallback.
    if (result.code === "23505") {
      return {
        ok: false,
        message: `A tag named "${name}" already exists.`,
      };
    }
    return {
      ok: false,
      message: "The tag could not be created. Please try again later.",
    };
  }

  return { ok: true, tag: result.tag };
}