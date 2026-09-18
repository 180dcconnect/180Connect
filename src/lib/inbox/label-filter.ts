/**
 * Does a thread pass the sidebar's label filter?
 *
 * The mailbox has two kinds of "label", and this is the one place that knows
 * both are the same control:
 *
 *   - the five built-in **sector** labels, which match a thread's derived
 *     `sector` (see `deriveSector` in ./real-threads.ts), and
 *   - **tags** (TAGS/ORG_TAGS, F188-F194), the shared labels the client record
 *     manages, which match by name against the tags on the thread's
 *     organisation.
 *
 * `applied` is a set of label *names* — exactly what the sidebar and the search
 * bar's sector chips put there. A thread matches when any applied name is
 * either its sector or one of its tags; an empty `applied` matches everything,
 * so the caller only needs to call this when a filter is actually on.
 *
 * Pure and dependency-free so the shell's filter stays testable without a
 * React tree — the same split every other `src/lib/inbox` helper follows.
 */

import type { InboxThreadTag } from "../inbox-thread-view.ts";

export function threadMatchesLabels(
  thread: { sector: string; tags?: readonly InboxThreadTag[] },
  applied: ReadonlySet<string>,
): boolean {
  if (applied.size === 0) return true;
  if (applied.has(thread.sector)) return true;
  for (const tag of thread.tags ?? []) {
    if (applied.has(tag.name)) return true;
  }
  return false;
}
