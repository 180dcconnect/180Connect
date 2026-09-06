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

/**
 * `E` defaults to PostgREST's `{ message }` — the shape reportError is given. A
 * caller that rethrows its error rather than reporting it can widen to
 * `unknown` and get the original object back untouched.
 */
export async function fetchPaged<T, E = { message: string }>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: E | null }>,
): Promise<PagedResult<T, E>> {
  const all: T[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await build(from, from + FETCH_STEP - 1);
    if (error) return { data: null, error, partial: all };
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < FETCH_STEP) break;
    from += FETCH_STEP;
  }
  return { data: all, error: null, partial: all };
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
  for (const ids of chunk(orgIds)) {
    const { data, error } = await fetchPaged<T>((from, to) => build(ids, from, to));
    if (error || !data) return { data: null, error, partial: all };
    all.push(...data);
  }
  return { data: all, error: null, partial: all };
}
