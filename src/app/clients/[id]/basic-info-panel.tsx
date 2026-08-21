"use client";

import { useEffect, useState } from "react";
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
import { InlineAlert } from "@/components/ui/inline-alert";

/**
 * Field order is reading order, not schema order. `wide` fields span both
 * columns: mission is a sentence or two and looked broken wrapping inside a
 * half-width cell beside a one-word Type.
 */
const FIELDS: {
  key: keyof ReturnType<typeof buildBasicInfo>;
  label: string;
  wide?: boolean;
}[] = [
  { key: "name", label: "Name", wide: true },
  { key: "mission", label: "Mission", wide: true },
  { key: "type", label: "Type" },
  { key: "status", label: "Status" },
  { key: "email", label: "Email" },
  { key: "location", label: "Location" },
  { key: "address", label: "Address", wide: true },
  { key: "website", label: "Website", wide: true },
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
}: {
  organisation: OrganisationDetailRow;
  missionStatement: string | null;
  missionEnrichedAt: string | null;
}) {
  const [state, setState] = useState<BasicInfoState>({
    organisation,
    missionStatement,
    missionEnrichedAt,
  });
  const [connectionLost, setConnectionLost] = useState(false);

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
        .subscribe((status) => {
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
            setConnectionLost(true);
          } else if (status === "SUBSCRIBED") {
            setConnectionLost(false);
          }
        });
    }

    subscribe();

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, [organisation.id]);

  const info = buildBasicInfo(state);

  return (
    <SectionCard headingId="basic-info-heading" title="Basic info">
      {connectionLost && (
        <div className="mb-4">
          <InlineAlert message="Live updates paused — refresh the page to see the latest changes." />
        </div>
      )}
      <dl className="mt-4 grid grid-cols-1 gap-x-8 sm:grid-cols-2">
        {FIELDS.map(({ key, label, wide }) => {
          // AC2: a field with no value still gets its row — greyed rather than
          // dropped, so "we don't know" reads differently from "it's blank".
          const missing = info[key] === NOT_PROVIDED;
          return (
            <div
              key={key}
              className={`border-b border-black/[0.05] py-3 last:border-b-0 ${
                wide ? "sm:col-span-2" : ""
              }`}
            >
              <dt className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/35">
                {label}
              </dt>
              <dd
                className={`mt-1 text-sm leading-[1.6] ${
                  missing ? "text-foreground/35" : "text-foreground/80"
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
