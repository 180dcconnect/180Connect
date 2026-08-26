/**
 * F182 — Team Pipeline View. Pure logic for /admin/team-pipeline: counts,
 * filtering, sorting and pagination over the team-wide client list.
 *
 * Kept dependency-free apart from the canonical status list and the shared
 * uuid check, so `node --test` can exercise it directly — same reasoning as
 * organisation-format.ts's header comment.
 */

import { PIPELINE_STATUSES } from "../organisation-format.ts";
import { isUuid } from "../validation.ts";

/** The owner-filter value that means "no owning CAM yet". */
export const UNASSIGNED_OWNER = "unassigned";

/** How many table rows one page of the view shows. */
export const PAGE_SIZE = 50;

export type TeamPipelineClient = {
  id: string;
  legal_name: string;
  outreach_status: string;
  owner_id: string | null;
  /** Resolved from the owner join server-side; null when unowned or unnamed. */
  owner_name: string | null;
};

export type TeamPipelineFilters = {
  q: string;
  statuses: string[];
  owners: string[];
};

export type StatusCount = { status: string; count: number };

/**
 * Clients per pipeline stage across the whole dataset, in the order the
 * pipeline defines them (docs/client-list-sorting.md). This is what lets an
 * admin read "how many clients are stuck at X" off a strip instead of counting
 * rows — so it is computed before any filter narrows the list, and it must
 * always sum to `rows.length`. A stage the enum grew after this file was
 * written still shows up rather than silently vanishing from the total.
 */
export function pipelineCounts(rows: TeamPipelineClient[]): StatusCount[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    counts.set(row.outreach_status, (counts.get(row.outreach_status) ?? 0) + 1);
  }
  const known = PIPELINE_STATUSES.filter((status) => counts.has(status)).map(
    (status) => ({ status, count: counts.get(status) ?? 0 }),
  );
  const extra = [...counts.keys()]
    .filter((status) => !(PIPELINE_STATUSES as readonly string[]).includes(status))
    .sort()
    .map((status) => ({ status, count: counts.get(status) ?? 0 }));
  return [...known, ...extra];
}

/**
 * Free text matches the client's name only — the one thing someone scanning a
 * pipeline by eye would look for. Case-insensitive substring.
 */
function matchesQuery(client: TeamPipelineClient, q: string): boolean {
  return client.legal_name.toLowerCase().includes(q);
}

/**
 * Narrows the list to the current filters. Empty filter lists mean "no
 * restriction on this axis"; an owner value may be a user id or the
 * {@link UNASSIGNED_OWNER} sentinel.
 */
export function filterTeamPipelineClients(
  rows: TeamPipelineClient[],
  filters: TeamPipelineFilters,
): TeamPipelineClient[] {
  const q = filters.q.trim().toLowerCase();
  const statuses = new Set(filters.statuses);
  const owners = new Set(filters.owners);
  const wantUnassigned = owners.has(UNASSIGNED_OWNER);

  return rows.filter((client) => {
    if (q && !matchesQuery(client, q)) return false;
    if (statuses.size > 0 && !statuses.has(client.outreach_status)) return false;
    if (owners.size > 0) {
      if (client.owner_id === null ? !wantUnassigned : !owners.has(client.owner_id)) {
        return false;
      }
    }
    return true;
  });
}

/**
 * Alphabetical by name, with the id as tie-break so two clients with the same
 * name keep one stable order between requests. Same ordering rationale as the
 * /clients default (docs/client-list-sorting.md).
 */
export function sortTeamPipelineClients(rows: TeamPipelineClient[]): TeamPipelineClient[] {
  return [...rows].sort((a, b) => {
    const byName = a.legal_name.localeCompare(b.legal_name);
    return byName !== 0 ? byName : a.id.localeCompare(b.id);
  });
}

export type Paginated<T> = {
  rows: T[];
  page: number;
  pageCount: number;
  total: number;
};

/**
 * Slices the filtered list into pages. A page past either end clamps into
 * range rather than rendering empty — deleting rows or tightening a filter
 * while someone sits on page 6 should show them the last real page, not a
 * blank table.
 */
export function paginateTeamPipelineClients<T>(
  rows: T[],
  rawPage: number,
  pageSize: number = PAGE_SIZE,
): Paginated<T> {
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const page = Math.min(Math.max(1, Math.floor(rawPage) || 1), pageCount);
  const start = (page - 1) * pageSize;
  return { rows: rows.slice(start, start + pageSize), page, pageCount, total: rows.length };
}

/**
 * Every CAM who currently owns at least one client — the owner filter's option
 * set comes from the data so it can never offer someone who owns nothing.
 * Unassigned is appended by the caller, not here: whether the pool exists is
 * a property of the data too.
 */
export function ownerOptions(
  rows: TeamPipelineClient[],
): Array<{ id: string; name: string }> {
  const byId = new Map<string, string>();
  for (const row of rows) {
    if (row.owner_id && !byId.has(row.owner_id)) {
      byId.set(row.owner_id, row.owner_name?.trim() || row.owner_id);
    }
  }
  return [...byId.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

type RawSearchParams = Record<string, string | string[] | undefined>;

function paramValues(params: RawSearchParams, key: string): string[] {
  const value = params[key];
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

/**
 * Turns the URL's search params into filters and a page number. Unknown
 * values are dropped, not rejected — a stale link carrying a retired status
 * degrades to "no filter on that axis", which is what a shared dashboard link
 * should do.
 */
export function parseTeamPipelineFilters(params: RawSearchParams): {
  filters: TeamPipelineFilters;
  page: number;
} {
  const statuses = paramValues(params, "status").filter((value) =>
    (PIPELINE_STATUSES as readonly string[]).includes(value),
  );
  const owners = paramValues(params, "owner").filter(
    (value) => isUuid(value) || value === UNASSIGNED_OWNER,
  );
  const q = (paramValues(params, "q")[0] ?? "").trim();
  const parsedPage = Number(paramValues(params, "page")[0]);
  const page = Number.isInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1;
  return { filters: { q, statuses, owners }, page };
}
