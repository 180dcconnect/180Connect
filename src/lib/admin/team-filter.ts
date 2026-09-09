import type { FilterOption } from "@/components/brand/search-bar";
import type { TeamUser } from "./team-realtime.ts";

export type RoleFilterValue = "cam" | "admin" | "viewer";
export type ClientCountFilterValue = "has_clients" | "0" | "1-5" | "6-10" | "10+";
export type LastActiveFilterValue =
  | "today"
  | "week"
  | "month"
  | "inactive_30d"
  | "inactive_90d"
  | "never";
export type StatusFilterValue = "active" | "deactivated";

export type TeamSortField = "name" | "role" | "clients" | "last_active";
export type SortOrder = "asc" | "desc";

export type TeamFilterCriteria = {
  query?: string;
  roles?: string[];
  clientRanges?: string[];
  lastActiveRanges?: string[];
  statuses?: string[];
  sortBy?: TeamSortField;
  sortOrder?: SortOrder;
};

export const ROLE_FILTER_OPTIONS: FilterOption[] = [
  { label: "CAM", value: "cam" },
  { label: "Admin", value: "admin" },
  { label: "Viewer", value: "viewer" },
];

export const CLIENT_COUNT_FILTER_OPTIONS: FilterOption[] = [
  { label: "Has clients (1+)", value: "has_clients" },
  { label: "No clients (0)", value: "0" },
  { label: "1–5 clients", value: "1-5" },
  { label: "6–10 clients", value: "6-10" },
  { label: "10+ clients", value: "10+" },
];

export const LAST_ACTIVE_FILTER_OPTIONS: FilterOption[] = [
  { label: "Active today", value: "today" },
  { label: "Active this week", value: "week" },
  { label: "Active this month", value: "month" },
  { label: "Inactive (> 30 days)", value: "inactive_30d" },
  { label: "Inactive (> 90 days)", value: "inactive_90d" },
  { label: "Never active", value: "never" },
];

export const STATUS_FILTER_OPTIONS: FilterOption[] = [
  { label: "Active accounts", value: "active" },
  { label: "Deactivated / Suspended", value: "deactivated" },
];

export const TEAM_SEARCH_CATEGORIES: Record<string, FilterOption[]> = {
  "Filter by role": ROLE_FILTER_OPTIONS,
  "Filter by client load": CLIENT_COUNT_FILTER_OPTIONS,
  "Filter by last active": LAST_ACTIVE_FILTER_OPTIONS,
  "Filter by status": STATUS_FILTER_OPTIONS,
};

export const TEAM_SEARCH_PARAMS: Record<string, string> = {
  "Filter by role": "role",
  "Filter by client load": "clients",
  "Filter by last active": "last_active",
  "Filter by status": "status",
};

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const ONE_WEEK_MS = 7 * ONE_DAY_MS;
const ONE_MONTH_MS = 30 * ONE_DAY_MS;
const NINETY_DAYS_MS = 90 * ONE_DAY_MS;

function matchesClientRange(count: number, range: string): boolean {
  switch (range) {
    case "has_clients":
      return count > 0;
    case "0":
      return count === 0;
    case "1-5":
      return count >= 1 && count <= 5;
    case "6-10":
      return count >= 6 && count <= 10;
    case "10+":
      return count >= 10;
    default:
      return true;
  }
}

function matchesLastActive(
  lastSeenAt: string | null,
  range: string,
  now: Date = new Date(),
): boolean {
  if (range === "never") {
    return lastSeenAt === null;
  }

  if (!lastSeenAt) {
    return false;
  }

  const seenTime = new Date(lastSeenAt).getTime();
  const nowTime = now.getTime();
  const elapsed = nowTime - seenTime;

  switch (range) {
    case "today":
      return elapsed >= 0 && elapsed <= ONE_DAY_MS;
    case "week":
      return elapsed >= 0 && elapsed <= ONE_WEEK_MS;
    case "month":
      return elapsed >= 0 && elapsed <= ONE_MONTH_MS;
    case "inactive_30d":
      return elapsed > ONE_MONTH_MS;
    case "inactive_90d":
      return elapsed > NINETY_DAYS_MS;
    default:
      return true;
  }
}

function matchesStatus(isActive: boolean, status: string): boolean {
  switch (status) {
    case "active":
      return isActive;
    case "deactivated":
      return !isActive;
    default:
      return true;
  }
}

export function filterTeamUsers(
  users: TeamUser[],
  criteria: TeamFilterCriteria,
  now: Date = new Date(),
): TeamUser[] {
  const query = criteria.query?.trim().toLowerCase();
  const roles = criteria.roles?.filter(Boolean);
  const clientRanges = criteria.clientRanges?.filter(Boolean);
  const lastActiveRanges = criteria.lastActiveRanges?.filter(Boolean);
  const statuses = criteria.statuses?.filter(Boolean);

  return users.filter((user) => {
    // 1. Text Search (Name or Email)
    if (query) {
      const name = (user.full_name ?? "").toLowerCase();
      const email = user.email.toLowerCase();
      if (!name.includes(query) && !email.includes(query)) {
        return false;
      }
    }

    // 2. Role Filter (OR within roles)
    if (roles && roles.length > 0) {
      if (!roles.includes(user.role)) {
        return false;
      }
    }

    // 3. Client Count Range Filter (OR within client ranges)
    if (clientRanges && clientRanges.length > 0) {
      const matchesAnyRange = clientRanges.some((range) =>
        matchesClientRange(user.listed_client_count, range),
      );
      if (!matchesAnyRange) {
        return false;
      }
    }

    // 4. Last Active Filter (OR within last active ranges)
    if (lastActiveRanges && lastActiveRanges.length > 0) {
      const matchesAnyActive = lastActiveRanges.some((range) =>
        matchesLastActive(user.last_seen_at, range, now),
      );
      if (!matchesAnyActive) {
        return false;
      }
    }

    // 5. Status Filter (OR within status filters)
    if (statuses && statuses.length > 0) {
      const matchesAnyStatus = statuses.some((status) =>
        matchesStatus(user.is_active, status),
      );
      if (!matchesAnyStatus) {
        return false;
      }
    }

    return true;
  });
}

const ROLE_RANK: Record<string, number> = {
  admin: 1,
  cam: 2,
  viewer: 3,
};

export function sortTeamUsers(
  users: TeamUser[],
  sortBy: TeamSortField = "name",
  sortOrder: SortOrder = "asc",
): TeamUser[] {
  const direction = sortOrder === "desc" ? -1 : 1;

  return [...users].sort((a, b) => {
    switch (sortBy) {
      case "name": {
        const nameA = (a.full_name ?? a.email).toLowerCase();
        const nameB = (b.full_name ?? b.email).toLowerCase();
        return nameA.localeCompare(nameB) * direction;
      }
      case "role": {
        const rankA = ROLE_RANK[a.role] ?? 99;
        const rankB = ROLE_RANK[b.role] ?? 99;
        if (rankA !== rankB) {
          return (rankA - rankB) * direction;
        }
        return (a.full_name ?? a.email).localeCompare(b.full_name ?? b.email);
      }
      case "clients": {
        const diff = a.listed_client_count - b.listed_client_count;
        if (diff !== 0) {
          return diff * direction;
        }
        return (a.full_name ?? a.email).localeCompare(b.full_name ?? b.email);
      }
      case "last_active": {
        if (!a.last_seen_at && !b.last_seen_at) {
          return (a.full_name ?? a.email).localeCompare(b.full_name ?? b.email);
        }
        if (!a.last_seen_at) return 1 * direction;
        if (!b.last_seen_at) return -1 * direction;
        const timeA = new Date(a.last_seen_at).getTime();
        const timeB = new Date(b.last_seen_at).getTime();
        return (timeA - timeB) * direction;
      }
      default:
        return 0;
    }
  });
}

export function parseArrayParam(
  param: string | string[] | undefined,
): string[] {
  if (!param) return [];
  if (Array.isArray(param)) return param;
  return [param];
}
