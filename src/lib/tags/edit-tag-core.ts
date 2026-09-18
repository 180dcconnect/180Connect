// F189: Edit Tag — pure decision logic.
//
// Same reasoning as create-tag-core.ts: no import of anything that pulls
// in "server-only", so this is directly unit-testable without a real
// Next.js request context.
//
// Real blocker, per the ticket's own note: "Blocked By: Who can edit shared
// tags", and "Additional context: Could be admin-only." Defaulting to
// admin-only here (see the migration's own comment for the full reasoning)
// — AC3 requires a clear message when a non-admin attempts this, not a
// silent failure, so isAdmin is checked here explicitly rather than left
// to RLS alone to fail silently.
//
// AC1/AC2: renaming a tag only ever updates the tags row itself — it never
// touches org_tags, so every existing assignment survives under the new
// name automatically, by construction, not by any special handling here.

export type EditTagResult =
  | { ok: true; tag: { id: string; name: string } }
  | { ok: false; message: string };

export interface TagUpdateClient {
  updateTagName(
    tagId: string,
    newName: string,
  ): Promise<
    | { ok: true; tag: { id: string; name: string } }
    | { ok: false; code: string | null; message: string }
  >;
}

export const EDIT_TAG_PERMISSION_REQUIRES_ADMIN = true as const;

export async function editTagCore(
  tagId: string,
  rawNewName: string,
  isAdmin: boolean,
  client: TagUpdateClient,
): Promise<EditTagResult> {
  // AC3: a clear message, not a silently failed save, when the actor
  // lacks permission.
  if (!isAdmin) {
    return {
      ok: false,
      message: "Only an admin can edit a shared tag.",
    };
  }

  const name = rawNewName.trim();
  if (name === "") {
    return { ok: false, message: "Enter a tag name." };
  }

  const result = await client.updateTagName(tagId, name);

  if (!result.ok) {
    if (result.code === "23505") {
      return {
        ok: false,
        message: `A tag named "${name}" already exists.`,
      };
    }
    return {
      ok: false,
      message: "The tag could not be updated. Please try again later.",
    };
  }

  return { ok: true, tag: result.tag };
}
