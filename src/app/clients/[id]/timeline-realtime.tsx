"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";

/**
 * F075 AC3 — live updates without navigating away. Subscribes across all four
 * sources `buildTimeline` reads (notes, outreach_messages, reply_events,
 * audit_log; all four added to `supabase_realtime` in 20260820110000) and
 * calls `router.refresh()` on any relevant change, rather than folding the
 * realtime payload into client state the way BasicInfoPanel does for a single
 * table.
 *
 * Deliberately not a fold: BasicInfoPanel's `applyOrganisationChange` only
 * ever has to merge one row shape into one state shape. This component would
 * need four, including re-deriving `note_added` vs `note_edited` and
 * re-resolving actor names for the two `audit_log` action types — all logic
 * that already exists once, server-side, in page.tsx + @/lib/timeline.ts.
 * Asking the server again is simpler and cannot drift from what a normal page
 * load renders.
 *
 * Renders nothing — it exists purely for the subscription's side effect,
 * mounted alongside TimelineSection in page.tsx.
 */
export function TimelineRealtimeRefresher({ organisationId }: { organisationId: string }) {
  const router = useRouter();

  useEffect(() => {
    const supabase = createClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;

    // Whether a change arrived while nobody was looking at this tab.
    let missedWhileHidden = false;

    /**
     * A hidden tab is not refreshed, it is marked stale.
     *
     * `router.refresh()` re-runs the whole server render for this record — the
     * layout and whichever tab is open. That is the right cost to pay for a
     * timeline someone is watching, and pure waste for one of the five client
     * tabs a CAM left open this morning. Since every teammate's note, email,
     * reply and status change on this record lands here, a background tab was
     * re-rendering all day for a screen nobody would look at again without
     * navigating (which refetches anyway).
     *
     * Nothing is lost by waiting: the flag is flushed on the way back, so
     * returning to the tab shows the same timeline an immediate refresh would
     * have produced.
     */
    function isVisible() {
      return typeof document === "undefined" || document.visibilityState === "visible";
    }

    // Coalesced, not per-event: one realtime burst (a batch reassignment
    // writes one audit row per client; a webhook retry can double-fire) would
    // otherwise trigger one full-page refetch per payload. Events arriving
    // within the window collapse into a single refresh.
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
      // See BasicInfoPanel for why this is required: the realtime socket does
      // not inherit the session the browser client reads from cookies, and an
      // unauthenticated subscription is silently redacted by RLS rather than
      // refused outright.
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (cancelled) return;
      supabase.realtime.setAuth(session?.access_token);

      channel = supabase
        .channel(`client-detail-timeline-${organisationId}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "notes", filter: `organisation_id=eq.${organisationId}` },
          () => scheduleRefresh(),
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "outreach_messages",
            filter: `organisation_id=eq.${organisationId}`,
          },
          () => scheduleRefresh(),
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "reply_events",
            filter: `organisation_id=eq.${organisationId}`,
          },
          () => scheduleRefresh(),
        )
        .on(
          "postgres_changes",
          // audit_log has no organisation_id column — target_id is what the
          // status_changed/ownership_reassigned RPCs set to the org's id, and
          // RLS (audit_log_select_client_timeline) already confines what this
          // subscription can see to just those two action types.
          { event: "INSERT", schema: "public", table: "audit_log", filter: `target_id=eq.${organisationId}` },
          () => scheduleRefresh(),
        )
        .subscribe();
    }

    subscribe();

    // Coming back to the tab is what pays off the deferral above. Only when
    // something actually arrived while it was hidden — returning to a tab that
    // nothing happened to costs nothing.
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
  }, [organisationId, router]);

  return null;
}
