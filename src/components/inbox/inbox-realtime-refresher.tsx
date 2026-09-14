"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";

/**
 * Makes a captured reply appear in an open inbox without a reload.
 *
 * The gmail-reply-check Edge Function gets a reply into reply_events within
 * about half a minute, but the mailbox is a server render: without this, the
 * CAM still saw it only on their next navigation. Same shape as TimelineRealtimeRefresher —
 * a coalesced router.refresh() rather than folding payloads into client state,
 * and a hidden tab is marked stale instead of re-rendered.
 *
 * reply_events INSERT only. outreach_messages is deliberately not watched:
 * every draft autosave updates it, and refreshing the mailbox on each keystroke
 * burst would be pure churn while someone is composing.
 */
export function InboxRealtimeRefresher() {
  const router = useRouter();

  useEffect(() => {
    const supabase = createClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    let missedWhileHidden = false;

    function isVisible() {
      return document.visibilityState === "visible";
    }

    function scheduleRefresh() {
      if (!isVisible()) {
        missedWhileHidden = true;
        return;
      }
      if (refreshTimer) return;
      refreshTimer = setTimeout(() => {
        refreshTimer = null;
        router.refresh();
      }, 500);
    }

    async function subscribe() {
      // The realtime socket does not inherit the cookie session; without
      // setAuth, RLS (reply_events_select_active) silently redacts every event.
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (cancelled) return;
      supabase.realtime.setAuth(session?.access_token);

      channel = supabase
        .channel("inbox-replies")
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "reply_events" },
          () => scheduleRefresh(),
        )
        .subscribe();
    }

    void subscribe();

    function flushOnReturn() {
      if (missedWhileHidden && isVisible()) {
        missedWhileHidden = false;
        scheduleRefresh();
      }
    }
    document.addEventListener("visibilitychange", flushOnReturn);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", flushOnReturn);
      if (refreshTimer) clearTimeout(refreshTimer);
      if (channel) supabase.removeChannel(channel);
    };
  }, [router]);

  return null;
}
