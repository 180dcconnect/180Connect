import type { MentionCandidate } from "./note-mentions.ts";

/**
 * F485 (#485) — shared client-side loader for the @mention directory
 * (`/api/users/mention-candidates`), used by both note composers (the
 * record's `AddNoteForm` and the list's `BulkActionsBar`).
 *
 * WHY NOT THE BULK BAR'S `team` PROP: that list is CAMs only
 * (`page.tsx` queries `users` with `eq("role", "cam")`, unfiltered by
 * `is_active`, with nullable names) because it feeds owner assignment and
 * filters. Mentions must offer every active teammate — admins and viewers
 * can read a client, so they must be mentionable — which is exactly what
 * the endpoint returns. Reusing `team` would save one tiny request at the
 * cost of silently unmentionable teammates; merging the two lists would
 * cost a second fetch anyway and leave two sources of truth for "who can
 * be mentioned".
 *
 * WHY LAZY, NOT A SERVER PROP: the directory rides zero page loads and is
 * fetched only once someone actually types `@` — the team table is tens of
 * rows, so the request is measured in milliseconds, and most page views
 * never pay it. Eager-loading it into `page.tsx`/`outreach/page.tsx` props
 * would charge every list and record view for a feature a fraction of them
 * use. The promise below is module-cached, so typing `@` in both composers
 * in one session still costs a single request; a failed load resets the
 * cache so the next `@` retries rather than sticking every later composer
 * with the failure.
 */

let cached: Promise<MentionCandidate[]> | null = null;

/** Sanitises the endpoint payload into candidates; drops anything malformed. */
export function parseMentionDirectoryResponse(body: unknown): MentionCandidate[] {
  if (typeof body !== "object" || body === null) return [];
  const users = (body as { users?: unknown }).users;
  if (!Array.isArray(users)) return [];
  const result: MentionCandidate[] = [];
  for (const row of users) {
    if (typeof row !== "object" || row === null) continue;
    const { id, fullName } = row as { id?: unknown; fullName?: unknown };
    if (typeof id !== "string" || id === "") continue;
    if (typeof fullName !== "string" || fullName.trim() === "") continue;
    result.push({ id, fullName: fullName.trim() });
  }
  return result;
}

export function getMentionDirectory(fetchImpl: typeof fetch = fetch): Promise<MentionCandidate[]> {
  if (!cached) {
    cached = fetchImpl("/api/users/mention-candidates")
      .then(async (response) => {
        if (!response.ok) throw new Error("directory unavailable");
        return parseMentionDirectoryResponse(await response.json());
      })
      .catch((error: unknown) => {
        cached = null;
        throw error;
      });
  }
  return cached;
}

/** Test seam: drops the cached promise so each test fetches fresh. */
export function resetMentionDirectoryCache(): void {
  cached = null;
}
