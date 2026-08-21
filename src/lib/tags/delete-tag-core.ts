// F190: Delete Tag — pure decision logic.
//
// Same reasoning as create-tag-core.ts: no import of anything that pulls
// in "server-only", so this is directly unit-testable without a real
// Next.js request context.
//
// AC2's open question ("Prevent deleting in-use tags?") gives two real
// options: warn with a count, or block entirely until unassigned. Chosen
// here: block. The ticket's own "avoid accidental deletion" framing
// favours the stricter option — a warning still lets someone click through
// carelessly, whereas blocking forces a genuinely deliberate two-step
// action (unassign everywhere, then delete). Flagged as the interpretation
// chosen, not a silent assumption; easy to switch to a warning if the team
// prefers once F190's actual open question gets a real answer.
//
// AC1 (confirmation before deleting) is a UI-level concern — this function
// doesn't do the confirming itself, but its own behaviour (refusing an
// in-use tag rather than deleting immediately) naturally supports a
// two-step "are you sure" flow at the UI layer.
//
// AC3 (a deleted tag no longer appears when assigning/filtering) needs no
// special handling — F191/F193 both query the tags table directly, so a
// genuinely deleted row simply stops appearing, by construction.

export type DeleteTagResult =
  | { ok: true }
  | { ok: false; message: string; assignedCount?: number };

export interface TagDeleteClient {
  countAssignments(tagId: string): Promise<number>;
  deleteTag(
    tagId: string,
  ): Promise<{ ok: true } | { ok: false; message: string }>;
}

export async function deleteTagCore(
  tagId: string,
  isAdmin: boolean,
  client: TagDeleteClient,
): Promise<DeleteTagResult> {
  if (!isAdmin) {
    return {
      ok: false,
      message: "Only an admin can delete a shared tag.",
    };
  }

  const assignedCount = await client.countAssignments(tagId);

  if (assignedCount > 0) {
    return {
      ok: false,
      message: `This tag is assigned to ${assignedCount} client${assignedCount === 1 ? "" : "s"}. Remove it from every client before deleting.`,
      assignedCount,
    };
  }

  const result = await client.deleteTag(tagId);
  if (!result.ok) {
    return {
      ok: false,
      message: "The tag could not be deleted. Please try again later.",
    };
  }

  return { ok: true };
}
