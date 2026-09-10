"use client";

import {
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type Dispatch,
  type SetStateAction,
} from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  ArrowUpDown,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Shield,
  UserCheck,
  UserX,
  X,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { sortTeamUsers, type SortOrder, type TeamSortField } from "@/lib/admin/team-filter";
import { Checkbox } from "@/components/animate-ui/components/radix/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getPageNumbers } from "@/components/ui/feed-pagination";

export type TeamUser = {
  id: string;
  email: string;
  full_name: string | null;
  role: "cam" | "admin" | "viewer";
  is_active: boolean;
  /**
   * F014. Null on an active account and on a merely suspended one; set when the
   * account was deactivated. `is_active` alone still decides whether they can log in —
   * this only says which kind of inactive they are.
   */
  deactivated_at: string | null;
  /** Last time this user was seen on any signed-in page — not last login. Null if never. */
  last_seen_at: string | null;
  owned_client_count: number;
  /**
   * F167. The subset of `owned_client_count` that /clients actually lists —
   * actively-suppressed clients are hidden there (F051 AC4). This is what the
   * Clients column links through to; `owned_client_count` stays the number the
   * reassignment gate reasons about, which has to include the suppressed ones.
   */
  listed_client_count: number;
};

/** First letters of the first two words or email. */
function initialsOf(name: string | null | undefined, email: string): string {
  if (name?.trim()) {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return parts[0].slice(0, 2).toUpperCase();
  }
  return email.slice(0, 2).toUpperCase();
}

/**
 * What the Clients cell promises before it is clicked. Suppressed clients are
 * owned but not listed, so they are named rather than silently missing from the
 * list the admin lands on.
 */
function clientsLinkTitle(user: TeamUser): string {
  const listed = user.listed_client_count;
  const hidden = user.owned_client_count - listed;
  const base = `View ${listed} client${listed === 1 ? "" : "s"} owned by ${displayName(user)}`;
  return hidden > 0
    ? `${base} (${hidden} more suppressed, not listed)`
    : base;
}

function displayName(user: TeamUser) {
  return user.full_name ?? user.email;
}

/**
 * "Last active" — not last login. `last_seen_at` is touched on every signed-in page
 * and admin API request (getCurrentActor), throttled to once per 5 minutes per user.
 */
function lastActiveLabel(lastSeenAt: string | null): string {
  if (!lastSeenAt) return "Never";
  const elapsedMs = Date.now() - new Date(lastSeenAt).getTime();
  if (elapsedMs < 60_000) return "Just now";
  const minutes = Math.floor(elapsedMs / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(lastSeenAt).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
}

const ROLE_LABEL: Record<TeamUser["role"], string> = {
  cam: "CAM",
  admin: "Admin",
  viewer: "Viewer",
};

const ROLE_STYLES: Record<TeamUser["role"], string> = {
  admin: "bg-[#f5efc6]/60 text-ink border-[#f5efc6]",
  cam: "bg-brand/10 text-brand-hover border-brand/20",
  viewer: "bg-sky-50 text-sky-900 border-sky-100",
};

const emptySubscribe = () => () => {};

export function UserManagementTable({
  users,
  totalCount,
  hasActiveFilters = false,
  setUsers,
  currentUserId,
}: {
  users: TeamUser[];
  totalCount?: number;
  hasActiveFilters?: boolean;
  setUsers?: Dispatch<SetStateAction<TeamUser[]>>;
  currentUserId?: string;
}) {
  const isClient = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
  const [sortBy, setSortBy] = useState<TeamSortField>("name");
  const [sortOrder, setSortOrder] = useState<SortOrder>("asc");
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(10);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Bulk action states
  const [rolePopoverOpen, setRolePopoverOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkMessage, setBulkMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Clear messages after a delay
  useEffect(() => {
    if (!bulkMessage) return;
    const timer = setTimeout(() => setBulkMessage(null), 5000);
    return () => clearTimeout(timer);
  }, [bulkMessage]);

  // Handle keyboard escape to clear selection
  useEffect(() => {
    if (selectedIds.size === 0) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !bulkBusy) {
        setSelectedIds(new Set());
        setRolePopoverOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedIds.size, bulkBusy]);

  function handleSort(field: TeamSortField) {
    if (sortBy === field) {
      setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(field);
      setSortOrder(field === "clients" || field === "last_active" ? "desc" : "asc");
    }
    setCurrentPage(1);
  }

  const sortedUsers = useMemo(() => {
    return sortTeamUsers(users, sortBy, sortOrder);
  }, [users, sortBy, sortOrder]);

  const total = totalCount ?? users.length;
  const isFiltered = hasActiveFilters && total !== sortedUsers.length;

  const totalPages = Math.max(1, Math.ceil(sortedUsers.length / pageSize));
  const activePage = Math.min(currentPage, totalPages);

  const paginatedUsers = useMemo(() => {
    const start = (activePage - 1) * pageSize;
    return sortedUsers.slice(start, start + pageSize);
  }, [sortedUsers, activePage, pageSize]);

  const pageIds = useMemo(() => paginatedUsers.map((u) => u.id), [paginatedUsers]);
  const isAllPageSelected = pageIds.length > 0 && pageIds.every((id) => selectedIds.has(id));
  const isSomePageSelected = pageIds.some((id) => selectedIds.has(id)) && !isAllPageSelected;
  const hasSelection = selectedIds.size > 0;

  function toggleSelectAllPage() {
    if (isAllPageSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const id of pageIds) next.delete(id);
        return next;
      });
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const id of pageIds) next.add(id);
        return next;
      });
    }
  }

  function toggleSelectUser(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleBulkRoleChange(newRole: "cam" | "admin" | "viewer") {
    setRolePopoverOpen(false);
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;

    // Filter out self if user selected their own account
    const applicableIds = ids.filter((id) => id !== currentUserId);
    const skippedSelf = ids.length !== applicableIds.length;

    if (applicableIds.length === 0) {
      setBulkMessage({
        type: "error",
        text: "You cannot change your own role through bulk actions.",
      });
      return;
    }

    setBulkBusy(true);
    setBulkMessage(null);

    let successCount = 0;
    let failCount = 0;

    const results = await Promise.allSettled(
      applicableIds.map(async (userId) => {
        const res = await fetch("/api/admin/users", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId, role: newRole }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? "Failed to update role");
        }
        return userId;
      }),
    );

    const succeededIds = new Set<string>();
    for (const result of results) {
      if (result.status === "fulfilled") {
        successCount++;
        succeededIds.add(result.value);
      } else {
        failCount++;
      }
    }

    if (setUsers && succeededIds.size > 0) {
      setUsers((prev) =>
        prev.map((u) => (succeededIds.has(u.id) ? { ...u, role: newRole } : u)),
      );
    }

    setBulkBusy(false);
    setSelectedIds(new Set());

    if (failCount === 0) {
      setBulkMessage({
        type: "success",
        text: `Updated ${successCount} member${successCount === 1 ? "" : "s"} to ${ROLE_LABEL[newRole]}${skippedSelf ? " (skipped your account)" : ""}.`,
      });
    } else {
      setBulkMessage({
        type: "error",
        text: `Updated ${successCount} member${successCount === 1 ? "" : "s"}, ${failCount} failed.`,
      });
    }
  }

  async function handleBulkStatusChange(isActive: boolean) {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;

    // Filter out self for suspension
    const applicableIds = !isActive ? ids.filter((id) => id !== currentUserId) : ids;
    const skippedSelf = !isActive && ids.length !== applicableIds.length;

    if (applicableIds.length === 0) {
      setBulkMessage({
        type: "error",
        text: "You cannot suspend your own account.",
      });
      return;
    }

    setBulkBusy(true);
    setBulkMessage(null);

    let successCount = 0;
    let failCount = 0;

    const results = await Promise.allSettled(
      applicableIds.map(async (userId) => {
        const res = await fetch("/api/admin/users", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId, isActive }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? "Failed to update status");
        }
        return userId;
      }),
    );

    const succeededIds = new Set<string>();
    for (const result of results) {
      if (result.status === "fulfilled") {
        successCount++;
        succeededIds.add(result.value);
      } else {
        failCount++;
      }
    }

    if (setUsers && succeededIds.size > 0) {
      setUsers((prev) =>
        prev.map((u) =>
          succeededIds.has(u.id)
            ? { ...u, is_active: isActive, deactivated_at: isActive ? null : u.deactivated_at }
            : u,
        ),
      );
    }

    setBulkBusy(false);
    setSelectedIds(new Set());

    const actionText = isActive ? "Reactivated" : "Suspended";
    if (failCount === 0) {
      setBulkMessage({
        type: "success",
        text: `${actionText} ${successCount} member${successCount === 1 ? "" : "s"}${skippedSelf ? " (skipped your account)" : ""}.`,
      });
    } else {
      setBulkMessage({
        type: "error",
        text: `${actionText} ${successCount} member${successCount === 1 ? "" : "s"}, ${failCount} failed.`,
      });
    }
  }

  const from = sortedUsers.length === 0 ? 0 : (activePage - 1) * pageSize + 1;
  const to = Math.min(activePage * pageSize, sortedUsers.length);
  const pageNumbers = getPageNumbers(activePage, totalPages);

  return (
    <div className="relative">
      {/* Action Notification Alert (if any) */}
      {bulkMessage && (
        <div
          role="alert"
          className={`flex items-center justify-between border-b px-5 py-2.5 text-xs font-semibold ${
            bulkMessage.type === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-red-200 bg-red-50 text-red-800"
          }`}
        >
          <span className="flex items-center gap-2">
            {bulkMessage.type === "success" ? (
              <Check className="size-4 shrink-0 text-emerald-600" />
            ) : (
              <X className="size-4 shrink-0 text-red-600" />
            )}
            <span>{bulkMessage.text}</span>
          </span>
          <button
            type="button"
            onClick={() => setBulkMessage(null)}
            className="cursor-pointer text-current opacity-60 hover:opacity-100"
            aria-label="Dismiss notification"
          >
            <X className="size-3.5" />
          </button>
        </div>
      )}

      {sortedUsers.length === 0 ? (
        <div className="py-12 px-5 text-center">
          <p className="text-sm text-foreground/60">
            {hasActiveFilters
              ? "No team members match the current search or filter criteria."
              : "No team members found."}
          </p>
          {hasActiveFilters && (
            <div className="mt-4">
              <Link
                href="/admin/users"
                className="inline-flex items-center justify-center rounded-xl bg-black/5 px-4 py-2 text-xs font-bold text-foreground transition-colors hover:bg-black/10"
              >
                Clear all filters
              </Link>
            </div>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-black/[0.08] bg-black/[0.02]">
                <th className="group/th w-11 px-4 py-3.5">
                  <div
                    className={`transition-opacity duration-150 ${
                      hasSelection ? "opacity-100" : "opacity-0 group-hover/th:opacity-100"
                    }`}
                  >
                    <Checkbox
                      aria-label="Select all on this page"
                      checked={
                        isAllPageSelected ? true : isSomePageSelected ? "indeterminate" : false
                      }
                      onCheckedChange={toggleSelectAllPage}
                    />
                  </div>
                </th>
                <th className="px-4 py-3.5">
                  <button
                    type="button"
                    onClick={() => handleSort("name")}
                    className="group inline-flex items-center gap-1.5 text-[11px] font-bold tracking-[0.12em] text-foreground/50 uppercase hover:text-foreground"
                  >
                    <span>Member</span>
                    {sortBy === "name" ? (
                      sortOrder === "asc" ? (
                        <ArrowUp className="size-3.5 text-foreground" />
                      ) : (
                        <ArrowDown className="size-3.5 text-foreground" />
                      )
                    ) : (
                      <ArrowUpDown className="size-3.5 opacity-0 transition-opacity group-hover:opacity-60" />
                    )}
                  </button>
                </th>
                <th className="w-36 px-4 py-3.5 text-center">
                  <button
                    type="button"
                    onClick={() => handleSort("role")}
                    className="group inline-flex items-center justify-center gap-1.5 text-[11px] font-bold tracking-[0.12em] text-foreground/50 uppercase hover:text-foreground"
                  >
                    <span className="size-3.5 shrink-0" aria-hidden="true" />
                    <span>Role</span>
                    {sortBy === "role" ? (
                      sortOrder === "asc" ? (
                        <ArrowUp className="size-3.5 shrink-0 text-foreground" />
                      ) : (
                        <ArrowDown className="size-3.5 shrink-0 text-foreground" />
                      )
                    ) : (
                      <ArrowUpDown className="size-3.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-60" />
                    )}
                  </button>
                </th>
                <th className="w-28 px-4 py-3.5 text-center">
                  <button
                    type="button"
                    onClick={() => handleSort("clients")}
                    className="group inline-flex items-center justify-center gap-1.5 text-[11px] font-bold tracking-[0.12em] text-foreground/50 uppercase hover:text-foreground"
                  >
                    <span className="size-3.5 shrink-0" aria-hidden="true" />
                    <span>Clients</span>
                    {sortBy === "clients" ? (
                      sortOrder === "asc" ? (
                        <ArrowUp className="size-3.5 shrink-0 text-foreground" />
                      ) : (
                        <ArrowDown className="size-3.5 shrink-0 text-foreground" />
                      )
                    ) : (
                      <ArrowUpDown className="size-3.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-60" />
                    )}
                  </button>
                </th>
                <th className="w-36 px-4 py-3.5">
                  <button
                    type="button"
                    onClick={() => handleSort("last_active")}
                    className="group inline-flex items-center gap-1.5 text-[11px] font-bold tracking-[0.12em] text-foreground/50 uppercase hover:text-foreground"
                  >
                    <span>Last active</span>
                    {sortBy === "last_active" ? (
                      sortOrder === "asc" ? (
                        <ArrowUp className="size-3.5 shrink-0 text-foreground" />
                      ) : (
                        <ArrowDown className="size-3.5 shrink-0 text-foreground" />
                      )
                    ) : (
                      <ArrowUpDown className="size-3.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-60" />
                    )}
                  </button>
                </th>
                <th className="w-28 px-4 py-3.5 text-right text-[11px] font-bold tracking-[0.12em] text-foreground/40 uppercase">
                  {hasActiveFilters ? (
                    <Link
                      href="/admin/users"
                      className="inline-flex items-center gap-1 font-normal tracking-normal text-xs text-brand hover:underline"
                    >
                      <X className="size-3" />
                      Reset filters
                    </Link>
                  ) : (
                    <span>Action</span>
                  )}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/5">
              {paginatedUsers.map((user) => {
                const roleLabel = ROLE_LABEL[user.role] ?? user.role;
                const roleStyle =
                  ROLE_STYLES[user.role] ?? "bg-black/5 text-foreground/75 border-black/10";
                const isSelected = selectedIds.has(user.id);
                const isSelf = user.id === currentUserId;
                const initials = initialsOf(user.full_name, user.email);

                return (
                  <tr
                    key={user.id}
                    className={`group/row transition-colors ${
                      isSelected ? "bg-brand/[0.04]" : "hover:bg-black/[0.015]"
                    }`}
                  >
                    <td className="w-11 px-4 py-3.5">
                      <div
                        className={`transition-opacity duration-150 ${
                          hasSelection || isSelected
                            ? "opacity-100"
                            : "opacity-0 group-hover/row:opacity-100"
                        }`}
                      >
                        <Checkbox
                          aria-label={`Select ${displayName(user)}`}
                          checked={isSelected}
                          onCheckedChange={() => toggleSelectUser(user.id)}
                        />
                      </div>
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-3">
                        <div className="relative flex size-9 shrink-0 items-center justify-center rounded-full bg-paper font-mono text-[11px] font-bold text-ink shadow-2xs">
                          {initials}
                          <span
                            className={`absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full border-2 border-white ${
                              user.is_active ? "bg-emerald-500" : "bg-amber-500"
                            }`}
                            title={user.is_active ? "Active" : "Inactive"}
                          />
                        </div>

                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <Link
                              href={`/team/${user.id}`}
                              className="font-bold text-foreground transition-colors hover:text-brand hover:underline"
                            >
                              {user.full_name ?? "Unnamed user"}
                            </Link>
                            {isSelf && (
                              <span className="rounded-full bg-black/[0.06] px-1.5 py-0.2 text-[10px] font-bold tracking-wider text-foreground/60 uppercase">
                                You
                              </span>
                            )}
                            {!user.is_active && (
                              <span className="rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[10px] font-bold tracking-wider text-red-700 uppercase">
                                {user.deactivated_at ? "Deactivated" : "Suspended"}
                              </span>
                            )}
                          </div>
                          <span className="block text-xs text-foreground/60">{user.email}</span>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3.5 text-center">
                      <span
                        aria-label={`Role for ${user.email}: ${roleLabel}`}
                        title="Change role on the member's profile page or via bulk actions"
                        className={`inline-flex items-center justify-center rounded-full border px-2.5 py-1 text-xs font-bold tracking-wide capitalize ${roleStyle}`}
                      >
                        {roleLabel}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 text-center">
                      {user.listed_client_count > 0 ? (
                        <Link
                          href={`/clients?owner=${user.id}`}
                          className="font-bold text-brand hover:underline"
                          title={clientsLinkTitle(user)}
                        >
                          {user.listed_client_count}
                        </Link>
                      ) : (
                        <span className="text-foreground/40" title={clientsLinkTitle(user)}>
                          {user.listed_client_count}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3.5 text-xs text-foreground/60">
                      {lastActiveLabel(user.last_seen_at)}
                    </td>
                    <td className="px-4 py-3.5 text-right">
                      <Link
                        href={`/team/${user.id}`}
                        className="group/btn inline-flex items-center gap-1.5 rounded-full border border-black/10 bg-white px-3.5 py-1.5 text-xs font-semibold text-foreground shadow-2xs transition-all hover:border-brand/40 hover:bg-brand/5 hover:text-brand"
                      >
                        <span>View</span>
                        <ArrowRight className="size-3 text-foreground/40 transition-transform duration-200 group-hover/btn:translate-x-0.5 group-hover/btn:text-brand" />
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Bottom Bar: Total Count Readout & Full Pagination Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-black/[0.06] bg-black/[0.015] px-4 py-3 sm:px-5">
        {/* Left: Total Count Readout & Rows per page */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5 text-[12px] text-foreground">
            <span>Show</span>
            <Select
              value={String(pageSize)}
              onValueChange={(val) => {
                setPageSize(Number(val));
                setCurrentPage(1);
              }}
            >
              <SelectTrigger
                size="sm"
                className="h-6 w-auto min-w-[44px] gap-1 rounded-md border border-black/[0.08] bg-white px-2 py-0 text-[12px] font-semibold text-foreground shadow-2xs hover:bg-black/5"
                aria-label="Items per page"
              >
                <SelectValue placeholder={String(pageSize)} />
              </SelectTrigger>
              <SelectContent align="start" className="min-w-[4.5rem]">
                {[10, 25, 50].map((size) => (
                  <SelectItem key={size} value={String(size)} className="text-xs">
                    {size}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-[12px] font-medium text-foreground">per page</span>
          </div>

          <span className="hidden h-3 w-px bg-black/[0.08] sm:inline-block" />

          <span className="text-[12px] font-medium text-foreground">
            {isFiltered ? (
              <span>
                Showing <strong className="font-semibold text-foreground">{from}–{to}</strong> of{" "}
                <strong className="font-semibold text-foreground">{sortedUsers.length}</strong> filtered (
                <span className="text-foreground/60">{total} total</span>)
              </span>
            ) : (
              <span>
                Showing <strong className="font-semibold text-foreground">{from}–{to}</strong> of{" "}
                <strong className="font-semibold text-foreground">{sortedUsers.length}</strong> team member
                {sortedUsers.length === 1 ? "" : "s"}
              </span>
            )}
          </span>
        </div>

        {/* Right: Page Navigation */}
        {totalPages > 1 && (
          <div className="flex items-center gap-1 sm:gap-1.5">
            <button
              type="button"
              disabled={activePage <= 1}
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              className="inline-flex items-center gap-0.5 rounded-lg px-2 py-1 text-xs font-semibold text-foreground/70 transition-colors hover:bg-black/5 hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
              aria-label="Previous page"
            >
              <ChevronLeft className="size-3.5" />
              <span className="hidden xs:inline">Prev</span>
            </button>

            <div className="flex items-center gap-1">
              {pageNumbers.map((p, idx) =>
                p === "..." ? (
                  <span key={`ellipsis-${idx}`} className="px-1 text-xs text-foreground/30">
                    …
                  </span>
                ) : (
                  <button
                    key={`page-${p}`}
                    type="button"
                    onClick={() => setCurrentPage(p as number)}
                    className={`flex h-7 min-w-[28px] items-center justify-center rounded-lg px-1.5 text-xs font-semibold transition-colors ${
                      activePage === p
                        ? "bg-foreground text-background shadow-xs"
                        : "text-foreground/60 hover:bg-black/5 hover:text-foreground"
                    }`}
                  >
                    {p}
                  </button>
                ),
              )}
            </div>

            <button
              type="button"
              disabled={activePage >= totalPages}
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              className="inline-flex items-center gap-0.5 rounded-lg px-2 py-1 text-xs font-semibold text-foreground/70 transition-colors hover:bg-black/5 hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
              aria-label="Next page"
            >
              <span className="hidden xs:inline">Next</span>
              <ChevronRight className="size-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* Floating Bulk Action Bar */}
      {isClient &&
        createPortal(
          <AnimatePresence>
            {selectedIds.size > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 20, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 15, scale: 0.95 }}
                transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                className="fixed bottom-6 left-1/2 z-[100] flex -translate-x-1/2 items-center gap-2 rounded-full border border-white/12 bg-[#141a22] px-4 py-2 text-white shadow-2xl backdrop-blur-md"
              >
                <div className="flex items-center gap-2 pr-2 border-r border-white/15 text-xs font-semibold">
                  <span className="flex size-5 items-center justify-center rounded-full bg-brand text-[10px] font-bold text-white">
                    {selectedIds.size}
                  </span>
                  <span>Selected</span>
                </div>

                {/* Role Changer Popover */}
                <Popover open={rolePopoverOpen} onOpenChange={setRolePopoverOpen}>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      disabled={bulkBusy}
                      className="inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-white/15 disabled:opacity-50"
                    >
                      <Shield className="size-3.5 text-brand" />
                      <span>Change role</span>
                      <ChevronDown className="size-3 opacity-60" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent
                    align="center"
                    side="top"
                    sideOffset={12}
                    className="w-48 rounded-2xl border border-white/15 bg-[#161d26] p-1.5 text-white shadow-2xl backdrop-blur-lg z-[110]"
                  >
                    <div className="px-2.5 py-1 text-[10px] font-bold tracking-wider text-white/45 uppercase">
                      Change role to
                    </div>
                    <div className="mt-1 space-y-0.5">
                      <button
                        type="button"
                        onClick={() => handleBulkRoleChange("cam")}
                        className="flex w-full cursor-pointer items-center justify-between rounded-xl px-2.5 py-2 text-left text-xs font-semibold text-white transition-colors hover:bg-white/10"
                      >
                        <span>CAM</span>
                        <span className="text-[10px] text-brand font-medium">Client Manager</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleBulkRoleChange("admin")}
                        className="flex w-full cursor-pointer items-center justify-between rounded-xl px-2.5 py-2 text-left text-xs font-semibold text-white transition-colors hover:bg-white/10"
                      >
                        <span>Admin</span>
                        <span className="text-[10px] text-[#f5efc6] font-medium">Full Access</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleBulkRoleChange("viewer")}
                        className="flex w-full cursor-pointer items-center justify-between rounded-xl px-2.5 py-2 text-left text-xs font-semibold text-white transition-colors hover:bg-white/10"
                      >
                        <span>Viewer</span>
                        <span className="text-[10px] text-sky-300 font-medium">Read Only</span>
                      </button>
                    </div>
                  </PopoverContent>
                </Popover>

                {/* Suspend Action */}
                <button
                  type="button"
                  disabled={bulkBusy}
                  onClick={() => handleBulkStatusChange(false)}
                  className="inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-amber-500/20 hover:text-amber-300 disabled:opacity-50"
                >
                  <UserX className="size-3.5 text-amber-400" />
                  <span>Suspend</span>
                </button>

                {/* Reactivate Action */}
                <button
                  type="button"
                  disabled={bulkBusy}
                  onClick={() => handleBulkStatusChange(true)}
                  className="inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-emerald-500/20 hover:text-emerald-300 disabled:opacity-50"
                >
                  <UserCheck className="size-3.5 text-emerald-400" />
                  <span>Reactivate</span>
                </button>

                {/* Cancel / Deselect */}
                <button
                  type="button"
                  disabled={bulkBusy}
                  onClick={() => setSelectedIds(new Set())}
                  aria-label="Deselect all"
                  className="flex size-7 cursor-pointer items-center justify-center rounded-full text-white/60 transition-colors hover:bg-white/10 hover:text-white"
                >
                  <X className="size-4" />
                </button>

                {bulkBusy && (
                  <div className="flex items-center gap-1.5 pl-1 text-xs text-white/80">
                    <Loader2 className="size-3.5 animate-spin text-brand" />
                    <span>Saving…</span>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>,
          document.body,
        )}
    </div>
  );
}
