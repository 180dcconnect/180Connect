"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/browser";
import {
  applyEnrichmentChange,
  applyOrganisationChange,
  buildBasicInfo,
  type BasicInfoState,
  type OrganisationDetailRow,
} from "@/lib/client-basic-info";

const FIELDS: { key: keyof ReturnType<typeof buildBasicInfo>; label: string }[] = [
  { key: "name", label: "Name" },
  { key: "type", label: "Type" },
  { key: "mission", label: "Mission" },
  { key: "email", label: "Email" },
  { key: "address", label: "Address" },
  { key: "location", label: "Location" },
  { key: "website", label: "Website" },
  { key: "status", label: "Status" },
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
    <section className="mt-6 rounded-xl border border-black/10 p-4" aria-labelledby="basic-info-heading">
      <h2 id="basic-info-heading" className="text-sm font-bold">Basic info</h2>
      <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
        {FIELDS.map(({ key, label }) => (
          <div key={key}>
            <dt className="text-xs font-bold uppercase tracking-wide text-foreground/50">{label}</dt>
            <dd className="mt-0.5 text-sm text-foreground/85">{info[key]}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
