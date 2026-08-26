// F190: Delete Tag — pure decision logic.
//
// No import of anything that pulls in "server-only", so this is directly
// unit-testable without a real Next.js request context (same reasoning as
// create-tag-core.ts).
//
// The database owns atomicity: the caller's client maps to the
// delete_unused_tag RPC, which counts assignments and deletes inside one
// transaction with an EXCLUSIVE lock on org_tags. A count made from the
// app and a delete made separately would race against ON DELETE CASCADE —
// an assignment added between the two calls would vanish silently (AC2's
// "never a silent, unqualified delete"). This core therefore never does a
// separate count-then-delete; it only interprets the outcome the database
// already enforced atomically.
//
// AC2's open question ("Prevent deleting in-use tags?") gives two real
// options: warn with a count, or block entirely until unassigned. Chosen
// here: block — the ticket's own "avoid accidental deletion" framing
// favours forcing a genuinely deliberate two-step action (unassign
// everywhere, then delete). Flagged as the interpretation chosen; easy to
// switch to a warning if the team prefers.
//
// AC1 (confirmation before deleting) is a UI-level concern — see the
// armed-confirm Delete button in editable-tag-list.tsx.
//
// AC3 needs no special handling: F191/F193 query the tags table directly,
// so a genuinely deleted row stops appearing by construction.

export type TagDeleteOutcome =
  | { status: "deleted" }
  | { status: "in_use"; assignedCount: number }
  | { status: "not_found" }
  | { status: "forbidden" }
  | { status: "check_failed" };

export interface TagDeleteClient {
  /** Atomically delete the tag if (and only if) it has no assignments. */
  deleteUnusedTag(tagId: string): Promise<TagDeleteOutcome>;
}

export type DeleteTagResult =
  | { ok: true }
  | { ok: false; message: string; assignedCount?: number };

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

  const outcome = await client.deleteUnusedTag(tagId);

  switch (outcome.status) {
    case "deleted":
      return { ok: true };

    case "not_found":
      // Already gone is the desired end state (e.g. two admins clicked at
      // once) — report success rather than a confusing failure.
      return { ok: true };

    case "forbidden":
      return {
        ok: false,
        message: "Only an admin can delete a shared tag.",
      };

    case "in_use": {
      const count = Math.max(0, Math.floor(outcome.assignedCount));
      return {
        ok: false,
        message: `This tag is assigned to ${count} client${count === 1 ? "" : "s"}. Remove it from every client before deleting.`,
        assignedCount: count,
      };
    }

    case "check_failed":
      // Honest failure: the database could not tell us whether the tag is
      // in use, so deletion stays blocked but the message must not claim a
      // specific assignment count that was never actually observed.
      return {
        ok: false,
        message:
          "We couldn't check whether this tag is in use. Please try again.",
      };
  }
}
