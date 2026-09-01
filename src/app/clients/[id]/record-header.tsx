import Link from "next/link";

import { createClient } from "@/lib/supabase/server";
import { reportError } from "@/lib/error-logging";
import { hasPermission } from "@/lib/auth/permissions";
import { formatLocation, formatOrganisationType } from "@/lib/organisation-format";
import { checkOwnershipConflict } from "@/lib/outreach/ownership-conflict";
import type { OwnershipRequestStatus } from "@/lib/ownership-requests";
import { BackButton } from "@/components/ui/back-button";
import { VerifiedCheck } from "@/components/verified-check";

const ACRONYMS = new Set(["CIC", "CIO", "LTD", "PLC", "LLP", "LBG", "IPS", "NHS", "GB", "UK", "USA"]);

function toTitleCase(value: string): string {
  return value
    .split(/(\s+)/)
    .map((token) => {
      if (/^\s+$/.test(token)) return token;
      return token
        .split("-")
        .map((segment) => {
          const parts = segment.split("'");
          return parts
            .map((part, idx) => {
              if (!part) return part;
              const upper = part.toUpperCase();
              if (ACRONYMS.has(upper)) return upper;
              if (idx > 0) return part.toLowerCase();
              return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
            })
            .join("'");
        })
        .join("-");
    })
    .join("");
}

import {
  loadClient,
  loadIdentifiers,
  loadOwner,
  loadRecordStats,
  loadScore,
  loadSources,
  loadSuppression,
  requireActor,
  type IdentifierRow,
} from "./load-record";
import { Key, Pill } from "./section-card";
import { OwnerControl } from "./owner-control";
import { PriorityDial } from "./priority-dial";
import { RecordMenu } from "./record-menu";
import { StatusSelect } from "./status-select";

/**
 * The record's persistent header. Renders once in `layout.tsx` and stays put
 * while the tabs change underneath it.
 *
 * Redesign (Sept 2026) — this used to be a charcoal band carrying blurred
 * colour blobs, a 5%-opacity monogram watermark, and five glass stat tiles
 * across its foot. It was the heaviest thing on the page and said very little:
 * ownership was shown read-only with a line telling you to scroll down to a card
 * to change it, and the stat strip restated counts that belong to the tabs.
 *
 * What replaces it is the thesis of the whole redesign. Every fact on this
 * record comes from a register a charity is legally required to file with, so
 * the header answers three questions in order:
 *
 *   1. **What is this?**   Legal name, type, location.
 *   2. **Says who?**       Verified registration numbers, and the registers the
 *                          record was assembled from. This is the part that has
 *                          never been on screen before.
 *   3. **So what?**        The priority score, and a plain-language call on it.
 *
 * Then the two things a CAM changes most — owner and pipeline stage — as
 * controls, on every tab, instead of cards further down the page.
 *
 * Still a server component: everything interactive is a client child, so the
 * header's markup never reaches the browser bundle.
 */

/** Registry vocabulary, from ORGANISATION_IDENTIFIERS.identifier_type. */
const IDENTIFIER_LABELS: Record<string, string> = {
  uk_charity: "UK charity",
  uk_company: "UK company",
  eu_company: "EU company",
  international_registry: "Registry",
  website: "Website",
  manual: "Manual",
};

function DocketChip({ row }: { row: IdentifierRow }) {
  const label = IDENTIFIER_LABELS[row.identifier_type] ?? row.identifier_type;
  const checked = row.verified_at
    ? new Date(row.verified_at).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : null;

  return (
    <span
      className="inline-flex items-center gap-2 rounded-inset border border-rule bg-white py-1 pr-2.5 pl-1.5 text-[12.5px] text-ink"
      title={
        row.registry_name
          ? `${row.registry_name}${checked ? ` · checked ${checked}` : ""}`
          : undefined
      }
    >
      <span className="rounded-[3px] bg-lead-wash px-1.5 py-0.5 font-mono text-[10px] tracking-[0.07em] text-lead uppercase">
        {label}
      </span>
      <span className="font-mono tabular-nums">{row.identifier_value}</span>
      <VerifiedCheck />
    </span>
  );
}

export async function RecordHeader({ organisationId }: { organisationId: string }) {
  const actor = await requireActor();
  const [client, owner, suppression, { score }, stats, identifiers, { sources }] =
    await Promise.all([
      loadClient(organisationId),
      loadOwner(organisationId),
      loadSuppression(organisationId),
      loadScore(organisationId),
      loadRecordStats(organisationId),
      loadIdentifiers(organisationId),
      loadSources(organisationId),
    ]);

  const canEdit = hasPermission(actor.role, "client:edit");
  const isAdmin = actor.role === "admin";
  const isSelf = owner.ownerId === actor.id;
  const canSetStatus = isAdmin || isSelf;

  // F165 — a CAM looking at someone else's client. The escalation off this is
  // the overflow menu's "Request ownership"; a CAM never overrides an owner.
  const ownershipConflict = checkOwnershipConflict({
    ownerId: owner.ownerId,
    ownerName: owner.ownerName,
    actorId: actor.id,
    actorRole: actor.role,
  });

  const supabase = await createClient();

  // F163: admin's CAM picker. Only fetched for an admin — nobody else can reach
  // the assign form, so the query would be wasted on every other page view.
  let team: { id: string; full_name: string | null }[] = [];
  if (isAdmin) {
    const { data, error } = await supabase
      .from("users")
      .select("id, full_name")
      .eq("role", "cam")
      .order("full_name");
    if (error) {
      await reportError(error, { operation: "clients.detail_team", organisationId });
    }
    team = data ?? [];
  }

  // #408: this viewer's most recent handover request, so the menu can show
  // "already asked, awaiting a decision" instead of offering the ask again.
  let ownershipRequestStatus: OwnershipRequestStatus | null = null;
  let ownershipDecisionNote: string | null = null;
  if (ownershipConflict.hasConflict) {
    const { data, error } = await supabase
      .from("ownership_requests")
      .select("status, decision_note")
      .eq("organisation_id", organisationId)
      .eq("requested_by", actor.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ status: OwnershipRequestStatus; decision_note: string | null }>();
    if (error) {
      await reportError(error, {
        operation: "clients.detail_ownership_request",
        organisationId,
      });
    }
    ownershipRequestStatus = data?.status ?? null;
    ownershipDecisionNote = data?.decision_note ?? null;
  }

  const lastActivity = stats.lastActivity
    ? new Date(stats.lastActivity).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : null;

  return (
    <div className="rounded-panel border border-rule bg-white">
      <div className="flex items-center justify-between gap-3 border-b border-rule-soft px-5 py-2.5">
        <BackButton href="/clients" />
        <RecordMenu
          canRequestOwnership={ownershipConflict.hasConflict}
          canSuppress={canEdit}
          isAdmin={isAdmin}
          organisationId={organisationId}
          ownerName={owner.ownerName}
          ownershipDecisionNote={ownershipDecisionNote}
          ownershipRequestStatus={ownershipRequestStatus}
          suppressed={suppression.suppressed}
          suppressionId={suppression.latest?.id}
          suppressionPending={suppression.suppressionPending}
        />
      </div>

      <div className="grid items-start gap-x-8 gap-y-6 px-5 py-6 lg:grid-cols-[minmax(0,1fr)_auto]">
        <div className="flex min-w-0 flex-col gap-3.5">
          <h1 className="font-body text-[clamp(2rem,4vw,2.75rem)] font-semibold leading-[1] tracking-[-0.03em] text-balance text-ink">
            {toTitleCase(client.legal_name)}
          </h1>

          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13.5px] text-dim">
            <span>{formatOrganisationType(client.organisation_type)}</span>
            <span aria-hidden="true" className="text-rule">
              ·
            </span>
            <span>{formatLocation(client)}</span>
            {suppression.suppressed && (
              <>
                <span aria-hidden="true" className="text-rule">
                  ·
                </span>
                <Pill tone="stop">Do not contact</Pill>
              </>
            )}
            {suppression.suppressionPending && (
              <>
                <span aria-hidden="true" className="text-rule">
                  ·
                </span>
                <Pill tone="hold">Do-not-contact requested</Pill>
              </>
            )}
          </div>

          {/* The docket. ORGANISATION_IDENTIFIERS has been in the schema since
              the start and has never been rendered — a charity number with the
              registry behind it is what makes this record citable. */}
          {identifiers.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {identifiers.map((row) => (
                <DocketChip key={`${row.identifier_type}-${row.identifier_value}`} row={row} />
              ))}
            </div>
          )}

          {/* Provenance, before anything else claims to be true. */}
          {sources.length > 0 &&
            (() => {
              const labels = sources.map((s) => s.label);
              const labelText =
                labels.length === 1
                  ? labels[0]
                  : labels.length === 2
                    ? `${labels[0]} and ${labels[1]}`
                    : `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
              const lastMs = Math.max(...sources.map((s) => new Date(s.first_seen_at).getTime()));
              const lastChecked = Number.isFinite(lastMs)
                ? new Date(lastMs).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
                : null;
              return (
                <p className="flex max-w-[58ch] gap-2.5 rounded-inset bg-paper px-3.5 py-3 text-[13.5px] leading-[1.55] text-dim">
                  <svg
                    aria-hidden="true"
                    className="mt-0.5 size-[15px] shrink-0 text-faint"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.9"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a2.5 2.5 0 0 1 0-5H20" />
                  </svg>
                  <span>
                    Assembled from{" "}
                    <strong className="font-semibold text-ink">
                      {sources.length === 1 ? "one register" : `${sources.length} registers`}
                    </strong>{" "}
                    — {labelText}.{lastChecked ? ` Last checked ${lastChecked}.` : ""}{" "}
                    <Link
                      className="border-b border-lead-wash whitespace-nowrap text-lead transition-colors hover:border-lead focus-visible:ring-2 focus-visible:ring-lead-mid focus-visible:outline-none"
                      href={`/clients/${organisationId}#source-heading`}
                    >
                      See what came from where
                    </Link>
                  </span>
                </p>
              );
            })()}
        </div>

        {/* The call. The number, the scale it sits on, and what earned it —
            unframed: the ring is already a container, and a panel around it was
            a box around a circle. */}
        <div className="flex shrink-0 items-center justify-center py-1">
          <PriorityDial
            band={score?.priority_band ?? null}
            factors={score?.score_factors ?? null}
            score={score?.priority_score ?? null}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-7 gap-y-3 px-5 py-3.5">
        <OwnerControl
          canEdit={canEdit}
          isAdmin={isAdmin}
          isSelf={isSelf}
          organisationId={organisationId}
          ownerId={owner.ownerId}
          ownerName={owner.ownerName}
          team={team}
        />
        {canSetStatus && (
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="font-body text-[12px] uppercase font-bold tracking-[-0.01em] text-ink">Stage</span>
            <StatusSelect
              currentStatus={client.outreach_status}
              organisationId={organisationId}
            />
          </div>
        )}
      </div>
    </div>
  );
}
