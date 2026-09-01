import { cache } from "react";
import { notFound, redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { getCurrentActor } from "@/lib/auth/actor";
import { adminRouteDestination } from "@/lib/auth/admin-route";
import { reportError } from "@/lib/error-logging";
import { checkWebsiteReachabilityCached } from "@/lib/website-reachability-cache";
import type { OrganisationDetailRow } from "@/lib/client-basic-info";
import type { LatestScoreDetailRow } from "./score-breakdown";

/**
 * The slice of the client record that the record *shell* needs — identity,
 * ownership, suppression state, score and the five headline counts — loaded once
 * per request and shared by `layout.tsx` and whichever tab page is rendering
 * underneath it.
 *
 * Everything here is wrapped in React's `cache()`. That is not an optimisation
 * so much as the thing that makes the layout/page split affordable at all: the
 * layout and the tab page render in the same request, both need the actor and
 * the organisation row, and without `cache()` each would re-run the auth
 * round-trip and the query. `getCurrentActor` is not memoised at its source (it
 * writes security-log rows on failure, so memoising it globally would change
 * behaviour for every caller) — it is memoised *here*, for this route only.
 *
 * Per-tab data stays in the tab's own `page.tsx`. This file is deliberately only
 * what the shell needs; adding a tab's queries here would put every tab's cost
 * back on every visit, which is the thing the split exists to undo.
 */

export type SuppressionRow = {
  id: string;
  status: "pending" | "active" | "rejected" | "lifted";
  reason: string;
  created_at: string;
};

export type OwnerRow = {
  owner_id: string | null;
  owner: { full_name: string | null } | null;
};

export type RecordStats = {
  emailsSent: number;
  replies: number;
  notes: number;
  /** ISO timestamp of the most recent thing that happened to this record. */
  lastActivity: string | null;
};

/** The actor, memoised for the request. Redirect handling lives in `requireActor`. */
export const loadActor = cache(async () =>
  getCurrentActor("client:view", { route: "/clients/[id]" }),
);

/**
 * The actor, or a redirect. Every server file under this route calls this rather
 * than `getCurrentActor` directly, so the gate cannot drift tab to tab.
 */
export const requireActor = cache(async () => {
  const authorization = await loadActor();
  if (!authorization.ok) redirect(adminRouteDestination(authorization.reason));
  return authorization.actor;
});

/**
 * The organisation row. `notFound()` here rather than in each tab: the layout
 * calls it first, so a dead id renders `not-found.tsx` without any tab work.
 */
export const loadClient = cache(async (id: string) => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("organisations")
    .select(
      "id, legal_name, organisation_type, website, contact_email, address_line_1, city, postcode, country_code, outreach_status",
    )
    .eq("id", id)
    .maybeSingle<OrganisationDetailRow>();

  if (error) {
    await reportError(error, { operation: "clients.detail_page", organisationId: id });
  }
  if (!data) notFound();
  return data;
});

/**
 * Owner is read separately from the organisation row on purpose: it is not part
 * of F068's realtime-driven basic-info state, and a deactivated owner's row is
 * invisible under `users_select_active`, which the name fallback covers.
 */
export const loadOwner = cache(async (id: string) => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("organisations")
    .select("owner_id, owner:users!organisations_owner_id_fkey(full_name)")
    .eq("id", id)
    .maybeSingle<OwnerRow>();

  if (error) {
    await reportError(error, { operation: "clients.detail_owner", organisationId: id });
  }

  const ownerId = data?.owner_id ?? null;
  return {
    ownerId,
    ownerName: data?.owner?.full_name ?? (ownerId ? "A former team member" : null),
  };
});

/**
 * Most recent suppression row whatever its status — pending shows a waiting
 * state, active shows the suppressed state, rejected/lifted/none all fall
 * through to the suppress action.
 */
export const loadSuppression = cache(async (id: string) => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("suppressions")
    .select("id, status, reason, created_at")
    .eq("organisation_id", id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<SuppressionRow>();

  return {
    latest: data ?? null,
    suppressed: data?.status === "active",
    suppressionPending: data?.status === "pending",
  };
});

/**
 * F095 — the persisted priority score and the per-factor inputs behind it. The
 * header shows the number; the Overview tab's breakdown card shows the factors.
 * One query serves both because of `cache()`.
 */
export const loadScore = cache(async (id: string) => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("latest_scores")
    .select("priority_score, priority_band, score_factors")
    .eq("organisation_id", id)
    .maybeSingle<LatestScoreDetailRow>();

  if (error) {
    await reportError(error, {
      operation: "clients.detail_score_breakdown",
      organisationId: id,
    });
  }
  return { score: data ?? null, error: Boolean(error) };
});

/** Website reachability, memoised so the header chip and the Contactability card agree. */
export const loadWebsite = cache(async (website: string | null) =>
  checkWebsiteReachabilityCached(website),
);

/**
 * The header's five numbers.
 *
 * The old single-page version derived these from rows it had already fetched for
 * the cards — every note, every outreach message, every reply, and a fully built
 * timeline. None of that is in scope for the shell any more, so each stat comes
 * from a count query that also returns the one row it needs for "last activity":
 * `{ count: "exact" }` plus `order(...).limit(1)` is a single round trip, not two.
 *
 * Last activity spans the same four sources the Activity tab's timeline merges,
 * so the header and that tab cannot disagree about when this record last moved.
 */
export const loadRecordStats = cache(async (id: string): Promise<RecordStats> => {
  const supabase = await createClient();

  const [sent, replies, notes, audit] = await Promise.all([
    supabase
      .from("outreach_messages")
      .select("sent_at", { count: "exact" })
      .eq("organisation_id", id)
      .eq("send_status", "sent")
      .order("sent_at", { ascending: false })
      .limit(1),
    supabase
      .from("reply_events")
      .select("received_at", { count: "exact" })
      .eq("organisation_id", id)
      .order("received_at", { ascending: false })
      .limit(1),
    supabase
      .from("notes")
      .select("created_at", { count: "exact" })
      .eq("organisation_id", id)
      .order("created_at", { ascending: false })
      .limit(1),
    supabase
      .from("audit_log")
      .select("created_at")
      .eq("target_table", "organisations")
      .eq("target_id", id)
      .in("action", [
        "status_changed",
        "ownership_reassigned",
        "edit_suggestion_approved",
        "edit_suggestion_rejected",
      ])
      .order("created_at", { ascending: false })
      .limit(1),
  ]);

  for (const [operation, result] of [
    ["clients.stats_sent", sent],
    ["clients.stats_replies", replies],
    ["clients.stats_notes", notes],
    ["clients.stats_audit", audit],
  ] as const) {
    if (result.error) await reportError(result.error, { operation, organisationId: id });
  }

  const timestamps = [
    sent.data?.[0]?.sent_at,
    replies.data?.[0]?.received_at,
    notes.data?.[0]?.created_at,
    audit.data?.[0]?.created_at,
  ].filter((value): value is string => typeof value === "string" && value.length > 0);

  return {
    emailsSent: sent.count ?? 0,
    replies: replies.count ?? 0,
    notes: notes.count ?? 0,
    lastActivity:
      timestamps.length > 0
        ? timestamps.reduce((latest, value) => (value > latest ? value : latest))
        : null,
  };
});
