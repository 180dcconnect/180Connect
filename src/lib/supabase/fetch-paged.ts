/**
 * PostgREST caps a single response at 1000 rows, so a plain `.select()` silently
 * truncates once a table grows past that — /dashboard records the 1794-row
 * staging dataset that first hit this. Every caller that reads a whole table
 * walks the range instead, and does it through this one helper so the loop
 * cannot be copy-pasted subtly wrong in a sixth place.
 *
 * The callback receives the window bounds rather than building them itself, so
 * a caller cannot pass a `.range()` that disagrees with the step size.
 */

export const FETCH_STEP = 1000;

export type PagedResult<T, E = { message: string }> = {
  /**
   * The complete set of rows, or null if the read failed. Null rather than a
   * short array on purpose: a count computed from half a table is not a smaller
   * number, it is a wrong one, so a caller has to opt into partial data.
   */
  data: T[] | null;
  error: E | null;
  /**
   * The rows retrieved before any failure — equal to `data` on success. For the
   * callers whose feature degrades rather than fails: an incomplete list of
   * stall flags flags fewer clients, which is a worse view but not a false one.
   */
  partial: T[];
};

export type FetchPagedOptions = {
  /**
   * How many 1000-row windows to request at once.
   *
   * The default, 1, walks the table one window after another — each request
   * waits for the last, so a 2,800-row table costs three round trips back to
   * back. A table known to run to a few thousand rows (organisations and what
   * hangs off it) should ask for several at once: the whole table then arrives
   * in one round, at the price of one empty window when the guess overshoots.
   * Keep it small — every window is a query against the database.
   */
  pagesPerRound?: number;
};

/**
 * `E` defaults to PostgREST's `{ message }` — the shape reportError is given. A
 * caller that rethrows its error rather than reporting it can widen to
 * `unknown` and get the original object back untouched.
 */
export async function fetchPaged<T, E = { message: string }>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: E | null }>,
  { pagesPerRound = 1 }: FetchPagedOptions = {},
): Promise<PagedResult<T, E>> {
  if (!Number.isInteger(pagesPerRound) || pagesPerRound < 1) {
    throw new RangeError("pagesPerRound must be a whole number of at least 1");
  }

  const all: T[] = [];
  for (let from = 0; ; from += FETCH_STEP * pagesPerRound) {
    const pages = await Promise.all(
      Array.from({ length: pagesPerRound }, (_, page) =>
        build(from + page * FETCH_STEP, from + (page + 1) * FETCH_STEP - 1),
      ),
    );
    // Read in window order, so the rows keep the query's ordering and a failure
    // in a later window still hands back every row before it.
    for (const { data, error } of pages) {
      if (error) return { data: null, error, partial: all };
      if (!data || data.length === 0) return { data: all, error: null, partial: all };
      all.push(...data);
      if (data.length < FETCH_STEP) return { data: all, error: null, partial: all };
    }
  }
}

/**
 * Longest `.in("organisation_id", …)` list we will put in one request. The ids
 * travel in the query string, and a few thousand UUIDs there overflows the
 * proxy's URL limit — a failure that only appears once a CAM owns enough
 * clients, i.e. never in dev and always in production.
 *
 * An RPC taking ids in its body has no such ceiling; those callers pass their
 * own, larger size.
 */
export const ID_CHUNK = 200;

/**
 * How many id chunks `fetchPagedForOrgs` reads at once. Enough that a CAM with a
 * thousand clients does not wait on five requests in a row; few enough that one
 * page load cannot open dozens of queries against a free-plan database.
 */
export const CHUNKS_PER_ROUND = 4;

export function chunk<T>(items: readonly T[], size = ID_CHUNK): T[][] {
  if (size < 1) throw new RangeError("chunk size must be at least 1");
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

/**
 * Paged fetch restricted to a set of organisations. Used where a page needs one
 * CAM's slice of a shared table: fetching the whole table and filtering in JS
 * gives the same answer but grows without bound as the rest of the team works.
 *
 * An empty id list short-circuits — `.in(…, [])` is a request that can only
 * return nothing.
 */
export async function fetchPagedForOrgs<T>(
  orgIds: readonly string[],
  build: (
    ids: string[],
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<PagedResult<T>> {
  if (orgIds.length === 0) return { data: [], error: null, partial: [] };

  const all: T[] = [];
  const chunks = chunk(orgIds);
  for (let start = 0; start < chunks.length; start += CHUNKS_PER_ROUND) {
    const results = await Promise.all(
      chunks
        .slice(start, start + CHUNKS_PER_ROUND)
        .map((ids) => fetchPaged<T>((from, to) => build(ids, from, to))),
    );
    // Concatenated in chunk order, so the result matches a sequential read.
    for (const { data, error } of results) {
      if (error || !data) return { data: null, error, partial: all };
      all.push(...data);
    }
  }
  return { data: all, error: null, partial: all };
}
