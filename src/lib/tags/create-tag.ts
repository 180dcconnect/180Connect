// F188: Create Tag.
//
// A CAM or admin creates a reusable, shared tag. Tags are platform-wide
// (AC2: available to everyone immediately, not personal to the creator) and
// case-insensitively unique (AC1: "urgent" and "Urgent" must not both exist
// — enforced at the database level too, via a unique index on lower(name),
// so this check is defence-in-depth, not the only guard).
//
// Scope note: this covers creating a tag only. Editing (F189), deleting
// (F190), assigning to an organisation (F191), removing from an
// organisation (F192), filtering by tag (F193), and setting a colour
// (F194) are separate tickets — this module does not do any of those.

import { createClient } from "../supabase/server.ts";
import { getCurrentActor, actorFailureMessage } from "../auth/actor.ts";
import { reportError } from "../error-logging.ts";

export type CreateTagResult =
  | { ok: true; tag: { id: string; name: string } }
  | { ok: false; message: string };

/** The one Supabase operation this needs, behind an interface — same
 * reasoning as OrganisationWriteStore: the validation/decision logic
 * (createTagCore) is testable without a real database or Next.js request
 * context. */
export interface TagInsertClient {
  insertTag(
    name: string,
    createdByUserId: string,
  ): Promise<
    | { ok: true; tag: { id: string; name: string } }
    | { ok: false; code: string | null; message: string }
  >;
}

/**
 * TODO: no dedicated "tags:create" (or similar) permission exists in
 * src/lib/auth/permissions.ts yet. "client:edit" is used here since tags
 * exist to organise clients (organisations) and every CAM already has that
 * permission — matches the ticket's "As a CAM, I want to create tags"
 * framing. Worth checking whether a dedicated permission should be added
 * instead, same open question as F039's "platform-settings:manage" choice.
 */
export const CREATE_TAG_PERMISSION = "client:edit" as const;

/**
 * Pure decision logic: validate, attempt the insert, translate the result
 * into a user-facing outcome. No Next.js request context, no cookies — just
 * the actor id and an injected client, so this is directly unit-testable.
 */
export async function createTagCore(
  rawName: string,
  actorId: string,
  client: TagInsertClient,
): Promise<CreateTagResult> {
  // AC3: empty name is blocked with a clear message. Trimmed first so
  // whitespace-only input ("   ") is treated the same as truly empty.
  const name = rawName.trim();
  if (name === "") {
    return { ok: false, message: "Enter a tag name." };
  }

  const result = await client.insertTag(name, actorId);

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

/** Real entry point — resolves actor and Supabase client from the actual
 * Next.js request, then delegates to the testable core above. */
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