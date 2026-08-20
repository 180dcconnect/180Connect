"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";

/**
 * F075 AC3 — live updates without navigating away. Subscribes across all four
 * sources `buildTimeline` reads (notes, outreach_messages, reply_events,
 * audit_log; all four added to `supabase_realtime` in 20260820090000) and
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
          () => router.refresh(),
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "outreach_messages",
            filter: `organisation_id=eq.${organisationId}`,
          },
          () => router.refresh(),
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "reply_events",
            filter: `organisation_id=eq.${organisationId}`,
          },
          () => router.refresh(),
        )
        .on(
          "postgres_changes",
          // audit_log has no organisation_id column — target_id is what the
          // status_changed/ownership_reassigned RPCs set to the org's id, and
          // RLS (audit_log_select_client_timeline) already confines what this
          // subscription can see to just those two action types.
          { event: "INSERT", schema: "public", table: "audit_log", filter: `target_id=eq.${organisationId}` },
          () => router.refresh(),
        )
        .subscribe();
    }

    subscribe();

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, [organisationId, router]);

  return null;
}
