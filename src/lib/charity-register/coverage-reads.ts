import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The reads the four coverage cards share.
 *
 * Every coverage finder used to open with the same full scan of
 * `organisation_identifiers` (`uk_charity`), so one page load scanned that
 * table four times — and then read its second table in 200-id chunks, one
 * chunk at a time. The page only ever needed the counts, but it paid for four
 * whole-book walks in series.
 *
 * Two changes live here, and the finders share both:
 *
 * - `loadCharityIdentifiers` runs the identifiers scan once. The approvals-style
 *   streaming cards memoise it per request (see `coverage-cards.tsx`), so the
 *   four cards split one scan instead of each running their own.
 * - `chunkIds` + `mapPool` run the follow-up chunk reads concurrently with a
 *   bound, instead of awaiting each 200-id slice before starting the next.
 */

export type CharityIdentifierRow = {
  organisation_id: string;
  identifier_value: string;
};

/**
 * Rows per read. PostgREST caps a response and does not say it truncated one,
 * so an unpaged read is a silent lie the moment the table outgrows the cap.
 * Below the server's own default so the last page is always short, which is
 * what ends the loop.
 */
const READ_PAGE = 900;

/**
 * One full scan of every charity identifier, oldest organisation first so the
 * pages tile rather than overlap. Throws on a failed page — the callers report
 * and degrade to no card, the way they always have.
 */
export async function loadCharityIdentifiers(
  supabase: SupabaseClient,
): Promise<CharityIdentifierRow[]> {
  const rows: CharityIdentifierRow[] = [];
  for (let from = 0; ; from += READ_PAGE) {
    const { data, error } = await supabase
      .from("organisation_identifiers")
      .select("organisation_id, identifier_value")
      .eq("identifier_type", "uk_charity")
      .order("organisation_id", { ascending: true })
      .range(from, from + READ_PAGE - 1)
      .returns<CharityIdentifierRow[]>();
    if (error) throw error;
    const page = data ?? [];
    rows.push(...page);
    if (page.length < READ_PAGE) return rows;
  }
}

/**
 * Split ids into `in (...)`-safe slices. A single list of a thousand uuids is
 * a ~40KB query string and PostgREST answers that with a bare 400 — the same
 * ceiling the backfills chunk by.
 */
export function chunkIds(ids: readonly string[], size = 200): string[][] {
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += size) chunks.push(ids.slice(i, i + size));
  return chunks;
}

/**
 * Reads per second, not concurrent requests without end: this runs on the
 * shared free-plan database beside live traffic, so the follow-up chunk reads
 * run at most this many at a time rather than all at once.
 */
export const READ_CONCURRENCY = 6;

/**
 * One async job per item with at most `limit` in flight, results in input
 * order. Order matters because the finders fill keyed maps from the pages —
 * and a reader comparing two runs should see the same organisation order.
 */
export async function mapPool<Item, Out>(
  items: readonly Item[],
  load: (item: Item, index: number) => Promise<Out>,
  limit: number = READ_CONCURRENCY,
): Promise<Out[]> {
  const results = new Array<Out>(items.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.min(Math.max(limit, 1), items.length) },
    async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await load(items[index], index);
      }
    },
  );
  await Promise.all(workers);
  return results;
}
