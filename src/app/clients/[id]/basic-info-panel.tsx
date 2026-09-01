"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/browser";
import {
  applyEnrichmentChange,
  applyOrganisationChange,
  buildBasicInfo,
  NOT_PROVIDED,
  type BasicInfoState,
  type OrganisationDetailRow,
} from "@/lib/client-basic-info";
import { SectionCard } from "./section-card";

/**
 * Field order is reading order, not schema order.
 *
 * `name` is deliberately absent: the record's header sets the legal name as the
 * page's h1, and repeating it as the first row of the first card was the card
 * telling you something you had just read.
 */
const FIELDS: {
  key: keyof ReturnType<typeof buildBasicInfo>;
  label: string;
}[] = [
  { key: "mission", label: "Mission" },
  { key: "type", label: "Type" },
  { key: "status", label: "Pipeline stage" },
  { key: "email", label: "Email" },
  { key: "location", label: "Location" },
  { key: "address", label: "Address" },
  { key: "website", label: "Website" },
];

/**
 * F068 — name, type, mission, email, address, location and status together in one
 * section (AC1), missing fields shown explicitly rather than dropped (AC2).
 *
 * A client component, not the server page, because AC3 requires this section to
 * pick up a basic-info edit made elsewhere without a page reload — the same
 * requirement F011 solved for the admin team list (team-panel.tsx). Requires
 * `organisations` and `enrichment_results` in the `supabase_realtime` publication
 * (20260806130000_enable_realtime_client_detail.sql); RLS still governs which rows
 * a subscriber actually receives.
 */
export function BasicInfoPanel({
  organisation,
  missionStatement,
  missionEnrichedAt,
  action,
}: {
  organisation: OrganisationDetailRow;
  missionStatement: string | null;
  missionEnrichedAt: string | null;
  /** Optional control pinned to the heading row — the "Suggest an edit" button. */
  action?: ReactNode;
}) {
  const [state, setState] = useState<BasicInfoState>({
    organisation,
    missionStatement,
    missionEnrichedAt,
  });

  useEffect(() => {
    const supabase = createClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;

    async function subscribe() {
      // The realtime WebSocket doesn't inherit the session the browser client reads
      // from cookies for normal requests — without handing it the access token
      // explicitly it connects as `anon`, which RLS then lets through with new/old
      // redacted to `{}` rather than skipped, producing a blank "ghost" update.
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (cancelled) return;
      supabase.realtime.setAuth(session?.access_token);

      channel = supabase
        .channel(`client-detail-basic-info-${organisation.id}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "organisations",
            filter: `id=eq.${organisation.id}`,
          },
          (payload) => {
            setState((current) =>
              applyOrganisationChange(current, {
                eventType: payload.eventType,
                new: payload.new as Partial<OrganisationDetailRow>,
              }),
            );
          },
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "enrichment_results",
            filter: `organisation_id=eq.${organisation.id}`,
          },
          (payload) => {
            setState((current) =>
              applyEnrichmentChange(current, {
                eventType: payload.eventType,
                new: payload.new as {
                  organisation_id?: string;
                  mission_statement?: string | null;
                  enriched_at?: string;
                },
              }),
            );
          },
        )
        .subscribe();
    }

    subscribe();

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, [organisation.id]);

  const info = buildBasicInfo(state);

  return (
    <SectionCard
      headingId="basic-info-heading"
      title="General Information"
      hint="Sourced from the registers above. A blank is a gap in the public record, not an error."
      action={action}
    >
      {/* Label-beside-value rather than label-above-value: these are short
          field names against short values, and stacking them doubled the card's
          height for no gain. */}
      <dl className="mt-3.5 flex flex-col">
        {FIELDS.map(({ key, label }) => {
          // AC2: a field with no value still gets its row — greyed rather than
          // dropped, so "we don't know" reads differently from "it's blank".
          const missing = info[key] === NOT_PROVIDED;
          return (
            <div
              key={key}
              className="grid gap-x-4 gap-y-0.5 border-t border-rule-soft py-2.5 first:border-t-0 first:pt-0 sm:grid-cols-[132px_minmax(0,1fr)]"
            >
              <dt className="text-[13px] text-dim">{label}</dt>
              <dd
                className={`min-w-0 text-sm leading-[1.55] ${
                  missing ? "text-faint" : "text-ink"
                }`}
              >
                {info[key]}
              </dd>
            </div>
          );
        })}
      </dl>
    </SectionCard>
  );
}
