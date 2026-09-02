import { cache } from "react";
import { notFound, redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { getCurrentActor } from "@/lib/auth/actor";
import { adminRouteDestination } from "@/lib/auth/admin-route";
import { reportError } from "@/lib/error-logging";
import { checkWebsiteReachabilityCached } from "@/lib/website-reachability-cache";
import {
  formatOrganisationSources,
  type OrganisationSourceRow,
} from "@/lib/source-tracking";
import {
  groupFieldSources,
  type FieldProvenance,
  type FieldSourceRow,
} from "@/lib/field-sources";
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

export type IdentifierRow = {
  identifier_type: string;
  identifier_value: string;
  registry_name: string | null;
  registry_country: string | null;
  is_primary: boolean | null;
  verified: boolean | null;
  verified_at: string | null;
};

export type LatestFinancialRow = {
  total_income: number | null;
  total_expenditure: number | null;
  income_band: string | null;
  period_end: string;
};

export type RecordStats = {
  emailsSent: number;
  replies: number;
  notes: number;
  /** Rows behind the Outreach, Financials and Activity tabs, for their counts. */
  outreach: number;
  financials: number;
  activity: number;
  /** ISO timestamp of the most recent thing that happened to this record. */
  lastActivity: string | null;
  /** Timestamp of the most recent outreach message sent. */
  lastContactedAt: string | null;
  /** Timestamp of the most recent client reply received. */
  lastReplyAt: string | null;
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
      "id, legal_name, organisation_type, website, contact_email, address_line_1, city, postcode, country_code, outreach_status, sector, sub_sector, created_at",
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

/**
 * The record's registration numbers — ORGANISATION_IDENTIFIERS.
 *
 * This table has existed since the schema was written and the client record has
 * never rendered a row of it. It is the whole basis of the redesign: a charity
 * number with the registry that issued it and the date it was last checked is
 * what makes this record a citable document rather than CRM data entry.
 * Primary identifiers first, then verified ones, so the strongest evidence leads.
 */
export const loadIdentifiers = cache(async (id: string) => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("organisation_identifiers")
    .select(
      "identifier_type, identifier_value, registry_name, registry_country, is_primary, verified, verified_at",
    )
    .eq("organisation_id", id)
    .order("is_primary", { ascending: false })
    .order("verified", { ascending: false })
    .returns<IdentifierRow[]>();

  if (error) {
    await reportError(error, {
      operation: "clients.detail_identifiers",
      organisationId: id,
    });
  }
  return data ?? [];
});

/**
 * Where each part of this record came from. Read by the header's provenance
 * line and by the Overview tab's sources card — one query for both.
 */
export const loadSources = cache(async (id: string) => {
  const supabase = await createClient();
  // The generated Supabase types do not know about this branch's RPC until the
  // remote schema is regenerated, so narrow its table-shaped result here.
  const { data, error } = await supabase.rpc("get_organisation_sources_with_actor", {
    p_organisation_id: id,
  });

  if (error) {
    await reportError(error, { operation: "clients.detail_sources", organisationId: id });
  }
  return {
    sources: formatOrganisationSources((data ?? []) as OrganisationSourceRow[]),
    error: Boolean(error),
  };
});

/**
 * Per-field provenance (F044, read via get_field_sources) — feeds the Activity
 * tab's "What came from where" card and the Overview tab's Manual Input row on
 * the Data Sources card, which only needs to know whether any field was ever
 * hand-entered. `hasManual` is the honest version of that question: a record
 * can carry manual field corrections without being a manual_entry_records
 * creation, and the reverse.
 */
export type FieldHistoryResult = {
  provenance: FieldProvenance[];
  hasManual: boolean;
  error: boolean;
};

export const loadFieldHistory = cache(async (id: string): Promise<FieldHistoryResult> => {
  const supabase = await createClient();
  // Like loadSources above: not in the generated types until the remote schema
  // is regenerated, so the row shape is narrowed here.
  const { data, error } = await supabase.rpc("get_field_sources", {
    p_organisation_id: id,
  });

  if (error) {
    await reportError(error, { operation: "clients.detail_field_sources", organisationId: id });
    return { provenance: [], hasManual: false, error: true };
  }

  const rows = (data ?? []) as FieldSourceRow[];
  return {
    provenance: groupFieldSources(rows),
    hasManual: rows.some((row) => row.source?.trim().toLowerCase() === "manual"),
    error: false,
  };
});

/** Website reachability, memoised so the header chip and the Contactability card agree. */
export const loadWebsite = cache(async (website: string | null) =>
  checkWebsiteReachabilityCached(website),
);

/**
 * Latest filed accounts period for financial scale context in the header.
 */
export const loadLatestFinancial = cache(async (id: string): Promise<LatestFinancialRow | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("financial_periods")
    .select("total_income, total_expenditure, income_band, period_end")
    .eq("organisation_id", id)
    .order("period_end", { ascending: false })
    .limit(1)
    .maybeSingle<LatestFinancialRow>();

  if (error) {
    await reportError(error, { operation: "clients.detail_latest_financial", organisationId: id });
  }
  return data ?? null;
});

/**
 * The header's numbers and activity timestamps.
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

  const [sent, replies, notes, audit, messages, grants, filings, attachments] =
    await Promise.all([
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
    // Tab counts. `head: true` fetches no rows at all — the number arrives in
    // the Content-Range header — so a badge on every tab costs four cheap
    // round trips, not four page-loads of data.
    supabase
      .from("outreach_messages")
      .select("id", { count: "exact", head: true })
      .eq("organisation_id", id),
    supabase
      .from("grants")
      .select("id", { count: "exact", head: true })
      .eq("organisation_id", id),
    supabase
      .from("financial_periods")
      .select("id", { count: "exact", head: true })
      .eq("organisation_id", id),
    supabase
      .from("attachments")
      .select("id", { count: "exact", head: true })
      .eq("organisation_id", id),
  ]);

  for (const [operation, result] of [
    ["clients.stats_sent", sent],
    ["clients.stats_replies", replies],
    ["clients.stats_notes", notes],
    ["clients.stats_audit", audit],
    ["clients.stats_messages", messages],
    ["clients.stats_grants", grants],
    ["clients.stats_filings", filings],
    ["clients.stats_attachments", attachments],
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
    outreach: messages.count ?? 0,
    financials: (grants.count ?? 0) + (filings.count ?? 0),
    // What the Activity tab actually lists: the timeline plus the files.
    activity:
      (notes.count ?? 0) +
      (messages.count ?? 0) +
      (replies.count ?? 0) +
      (attachments.count ?? 0),
    lastActivity:
      timestamps.length > 0
        ? timestamps.reduce((latest, value) => (value > latest ? value : latest))
        : null,
    lastContactedAt: sent.data?.[0]?.sent_at ?? null,
    lastReplyAt: replies.data?.[0]?.received_at ?? null,
  };
});
