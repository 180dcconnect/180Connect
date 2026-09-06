/**
 * PostgREST caps a single response at 1000 rows, so a plain `.select()` silently
 * truncates once a table grows past that — /dashboard records the 1794-row
 * staging dataset that first hit this. Every analytics page walks the range
 * instead, and does it through this one helper so the loop cannot be
 * copy-pasted subtly wrong in a fifth place.
 *
 * The callback receives the window bounds rather than building them itself, so
 * a caller cannot pass a `.range()` that disagrees with the step size.
 */

export const FETCH_STEP = 1000;

export type PagedResult<T> = {
  data: T[] | null;
  error: { message: string } | null;
};

export async function fetchPaged<T>(
  build: (from: number, to: number) => PromiseLike<PagedResult<T>>,
): Promise<PagedResult<T>> {
  const all: T[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await build(from, from + FETCH_STEP - 1);
    if (error) return { data: null, error };
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < FETCH_STEP) break;
    from += FETCH_STEP;
  }
  return { data: all, error: null };
}

/**
 * Longest `.in("organisation_id", …)` list we will put in one request. The ids
 * travel in the query string, and a few thousand UUIDs there overflows the
 * proxy's URL limit — a failure that only appears once a CAM owns enough
 * clients, i.e. never in dev and always in production.
 */
export const ID_CHUNK = 200;

export function chunkIds(ids: readonly string[], size = ID_CHUNK): string[][] {
  const chunks: string[][] = [];
  for (let index = 0; index < ids.length; index += size) {
    chunks.push(ids.slice(index, index + size));
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
  build: (ids: string[], from: number, to: number) => PromiseLike<PagedResult<T>>,
): Promise<PagedResult<T>> {
  if (orgIds.length === 0) return { data: [], error: null };

  const all: T[] = [];
  for (const ids of chunkIds(orgIds)) {
    const { data, error } = await fetchPaged<T>((from, to) => build(ids, from, to));
    if (error || !data) return { data: null, error };
    all.push(...data);
  }
  return { data: all, error: null };
}
