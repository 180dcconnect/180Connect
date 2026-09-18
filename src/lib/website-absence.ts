/**
 * "This client has no website" — what the admin is told when the mark won't save.
 *
 * The mark itself lives in the database (`set_website_absent`, 20261018090000):
 * an admin-only, audited RPC. This module is only the layer that turns a Postgres
 * refusal into something an admin can act on — never the internal name of a
 * column, a table or an error code (AGENTS.md, "Who will maintain this app").
 *
 * Pure and dependency-free, so it can be imported under plain `node --test` — the
 * same rule `organisation-format.ts` follows.
 */

const GENERIC_FAILURE =
  "That could not be saved. Refresh the page and try again.";

/**
 * Whether the website part of an incomplete-record check is resolved.
 *
 * A real URL resolves it, as does the audited admin confirmation that the
 * client genuinely has no website. Redaction placeholders never count as a
 * usable URL; callers already detect those while building the rest of the
 * record's completeness state, so that fact is explicit here too.
 */
export function hasResolvedWebsite({
  website,
  websiteAbsentAt,
  websiteIsRedacted = false,
}: {
  website: string | null | undefined;
  websiteAbsentAt: string | null | undefined;
  websiteIsRedacted?: boolean;
}): boolean {
  return Boolean(
    (website?.trim() && !websiteIsRedacted) || websiteAbsentAt?.trim(),
  );
}

/**
 * Maps a Postgres error from `set_website_absent` onto something safe to show.
 *
 * Each errcode below is one the RPC raises deliberately; everything else — a
 * dropped connection, a permission the database changed under us — gets the
 * generic string rather than a description of the plumbing.
 */
export function websiteAbsenceFailureMessage(error: {
  code?: string;
  message?: string;
}): string {
  switch (error.code) {
    case "42501":
      return "Only an admin can record that a client has no website.";
    case "23514":
      // The screen only offers the mark on a client with no website, so reaching
      // this means the record gained one since the page was loaded.
      return "That client now has a website on file, so it can't be marked as having none. Refresh the page to see it.";
    case "P0002":
      return "That client could not be found. Refresh the page and try again.";
    default:
      return GENERIC_FAILURE;
  }
}

/**
 * What the admin is told when the mark works. The card's own heading already says
 * which client it is, but a toast is read on its own, so it names them too.
 */
export function websiteAbsenceSavedMessage(absent: boolean, clientName: string): string {
  return absent
    ? `Recorded that ${clientName} has no website`
    : `${clientName} is back on the website list`;
}
