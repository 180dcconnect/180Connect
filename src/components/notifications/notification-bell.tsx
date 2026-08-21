"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, CheckCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/browser";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/animate-ui/components/radix/tooltip";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
} from "@/components/animate-ui/components/radix/dropdown-menu";
import {
  getMyNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "@/lib/notifications-actions";
import {
  notificationRelativeTime,
  type NotificationItem,
} from "@/lib/notifications";

/**
 * F173 — the bell in the sidebar footer. One component owns the whole
 * notification surface for now: badge count, panel list, mark-read on click.
 *
 * Delivery is push-first (AC2): a realtime subscription on the caller's own
 * rows triggers a coalesced refetch, exactly like TimelineRealtimeRefresher —
 * refetching rather than folding the payload keeps one server-side mapping
 * and cannot drift from a normal page load. Window focus is the fallback
 * path, so a dropped socket self-heals the next time the tab is looked at.
 */
export function NotificationBell({ collapsed }: { collapsed: boolean }) {
  const router = useRouter();
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [open, setOpen] = useState(false);
  const userIdRef = useRef<string | null>(null);

  const reload = useCallback(async () => {
    const result = await getMyNotifications();
    if (!result.ok) return;
    setItems(result.items);
    setUnreadCount(result.unreadCount);
  }, []);

  // Initial load + realtime subscription + focus fallback.
  useEffect(() => {
    const supabase = createClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;
    let reloadTimer: ReturnType<typeof setTimeout> | null = null;

    // Coalesced: one burst of inserts collapses into one refetch.
    function scheduleReload() {
      if (reloadTimer) return;
      reloadTimer = setTimeout(() => {
        reloadTimer = null;
        void reload();
      }, 500);
    }

    async function subscribe() {
      await reload();
      if (cancelled) return;

      const {
        data: { session },
      } = await supabase.auth.getSession();
      const uid = session?.user?.id ?? null;
      userIdRef.current = uid;
      if (!uid || cancelled) return;

      // The socket does not inherit the cookie session; without setAuth an
      // unauthenticated subscription is silently redacted by RLS.
      supabase.realtime.setAuth(session?.access_token);

      channel = supabase
        .channel(`notifications-${uid}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "notifications",
            filter: `recipient_user_id=eq.${uid}`,
          },
          () => scheduleReload(),
        )
        .subscribe();
    }

    function onFocus() {
      void reload();
    }
    window.addEventListener("focus", onFocus);

    void subscribe();

    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
      if (reloadTimer) clearTimeout(reloadTimer);
      if (channel) supabase.removeChannel(channel);
    };
  }, [reload]);

  const handleClick = async (item: NotificationItem) => {
    if (!item.readAt) {
      // Optimistic: the badge should drop before the RPC round-trips.
      setItems((prev) =>
        prev.map((n) =>
          n.id === item.id
            ? { ...n, readAt: new Date().toISOString() }
            : n,
        ),
      );
      setUnreadCount((c) => Math.max(0, c - 1));
      void markNotificationRead(item.id).then(() => undefined);
    }
    setOpen(false);
    if (item.linkPath) router.push(item.linkPath);
  };

  const handleMarkAll = async () => {
    setItems((prev) =>
      prev.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })),
    );
    setUnreadCount(0);
    await markAllNotificationsRead();
  };

  const button = (
    <button
      type="button"
      onClick={() => {
        setOpen((o) => !o);
        void reload();
      }}
      aria-label={
        unreadCount > 0
          ? `Notifications, ${unreadCount} unread`
          : "Notifications"
      }
      className={`relative flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-semibold text-black transition-all hover:bg-black/10 ${
        collapsed ? "justify-center" : ""
      }`}
    >
      <span className="relative shrink-0">
        <Bell className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
        {unreadCount > 0 && (
          <span
            className="absolute -right-1.5 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold leading-none text-white"
            aria-hidden="true"
          >
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </span>
      {!collapsed && <span>Notifications</span>}
    </button>
  );

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        {collapsed ? (
          <Tooltip delayDuration={400}>
            <TooltipTrigger asChild>{button}</TooltipTrigger>
            <TooltipContent
              side="right"
              sideOffset={10}
              showArrow={false}
              className="rounded-xl bg-neutral-900 px-3.5 py-2 text-sm font-semibold text-white shadow-lg"
            >
              Notifications
            </TooltipContent>
          </Tooltip>
        ) : (
          button
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="right"
        align="end"
        sideOffset={10}
        className="w-80 rounded-xl p-1.5 shadow-lg"
      >
        <div className="flex items-center justify-between px-2 py-1.5">
          <p className="text-xs font-bold uppercase tracking-wide text-black/40">
            Notifications
          </p>
          {unreadCount > 0 && (
            <button
              type="button"
              onClick={handleMarkAll}
              className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-semibold text-black/60 transition-colors hover:bg-black/10 hover:text-black"
            >
              <CheckCheck className="h-3.5 w-3.5" aria-hidden="true" />
              Mark all read
            </button>
          )}
        </div>
        <div className="max-h-96 overflow-y-auto">
          {items.length === 0 ? (
            <p className="px-2 py-6 text-center text-sm text-black/50">
              No notifications yet
            </p>
          ) : (
            items.map((item) => {
              const unread = item.readAt === null;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => void handleClick(item)}
                  className={`block w-full rounded-lg px-2 py-2 text-left transition-colors hover:bg-black/8 ${
                    unread ? "bg-black/4" : ""
                  }`}
                >
                  <p className="flex items-start gap-2 text-sm font-semibold text-black">
                    {unread && (
                      <span
                        className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-blue-600"
                        aria-hidden="true"
                      />
                    )}
                    <span className="min-w-0">{item.title}</span>
                  </p>
                  {item.body && (
                    <p className="mt-0.5 line-clamp-2 pl-4 text-xs text-black/60">
                      {item.body}
                    </p>
                  )}
                  <p className="mt-1 pl-4 text-[11px] text-black/40">
                    {notificationRelativeTime(item)}
                  </p>
                </button>
              );
            })
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
