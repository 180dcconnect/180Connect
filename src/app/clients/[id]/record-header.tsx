import Link from "next/link";

import { createClient } from "@/lib/supabase/server";
import { reportError } from "@/lib/error-logging";
import { hasPermission } from "@/lib/auth/permissions";
import { formatCityWithRegion, formatOrganisationType } from "@/lib/organisation-format";
import { checkOwnershipConflict } from "@/lib/outreach/ownership-conflict";
import type { OwnershipRequestStatus } from "@/lib/ownership-requests";
import { buildCompleteness } from "@/lib/client-completeness";
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

import { Calendar, Mail, MapPin } from "lucide-react";
import { INCOME_BAND_LABELS, type IncomeBand } from "@/lib/income-band";

import {
  loadClient,
  loadIdentifiers,
  loadLatestFinancial,
  loadOwner,
  loadRecordStats,
  loadScore,
  loadSources,
  loadSuppression,
  requireActor,
  type IdentifierRow,
  type LatestFinancialRow,
} from "./load-record";
import { Pill } from "./section-card";
import { OwnerControl } from "./owner-control";
import { CompletenessTicks } from "./completeness-ticks";
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

/**
 * Header-only wording. This strip sits beside verified register numbers, so the
 * type says where the claim comes from — but the shared formatter's short
 * labels stay as they are, because the client-list filters and insight groupings
 * want "Charity", not a sentence.
 */
function headerOrganisationType(type: string): string {
  if (type === "charity") return "Registered charity";
  if (type === "company") return "Registered company";
  if (type === "both") return "Registered charity and company";
  return formatOrganisationType(type);
}

/** No city on the row does not mean unknown — it means the register entry is
 * not pinned to one. Say that, in the country's own name rather than an ISO
 * code that reads like a glitch. */
const COUNTRY_NAMES: Record<string, string> = {
  GB: "United Kingdom",
};

function headerLocation(client: { city: string | null; country_code: string }): string {
  const city = client.city?.trim();
  if (city) return formatCityWithRegion(toTitleCase(city));
  return `Nationwide · ${COUNTRY_NAMES[client.country_code] ?? client.country_code}`;
}

function formatFinancialScale(financial: LatestFinancialRow | null): string | null {
  if (!financial) return null;
  const year = financial.period_end ? new Date(financial.period_end).getFullYear() : null;
  const shortYear = year ? `FY${String(year).slice(-2)}` : null;

  if (financial.total_income !== null && financial.total_income !== undefined) {
    const income = financial.total_income;
    const formatted =
      income >= 1_000_000
        ? `£${(income / 1_000_000).toFixed(1).replace(/\.0$/, "")}m`
        : income >= 1_000
          ? `£${Math.round(income / 1_000)}k`
          : `£${income.toLocaleString("en-GB")}`;
    return shortYear ? `${formatted} income (${shortYear})` : `${formatted} income`;
  }

  if (financial.income_band && financial.income_band in INCOME_BAND_LABELS) {
    return `${INCOME_BAND_LABELS[financial.income_band as IncomeBand]} income`;
  }

  return null;
}

import { formatShortDate } from "@/lib/display-format";

function formatLastContacted(
  lastContactedAt: string | null,
  emailsSent: number,
  now: Date = new Date(),
): string {
  if (!lastContactedAt || emailsSent === 0) {
    return "No outreach yet";
  }
  const DAY_MS = 24 * 60 * 60 * 1000;
  const daysSince = Math.floor((now.getTime() - new Date(lastContactedAt).getTime()) / DAY_MS);
  if (daysSince === 0) return "Last contacted today";
  if (daysSince === 1) return "Last contacted yesterday";
  if (daysSince < 30) return `Last contacted ${daysSince}d ago`;
  return `Last contacted ${formatShortDate(lastContactedAt)}`;
}

function formatDateAdded(createdAt?: string | null): string | null {
  if (!createdAt) return null;
  return `Added ${formatShortDate(createdAt)}`;
}

function getOperationalInsights(
  outreachStatus: string,
  lastContactedAt: string | null,
  lastReplyAt: string | null,
  now: Date = new Date(),
): { label: string; tone: "go" | "stop" | "hold" } | null {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const nowMs = now.getTime();

  if (outreachStatus === "initial_outreach_sent") {
    if (!lastContactedAt) return { label: "Initial outreach sent", tone: "hold" };
    const daysSince = Math.floor((nowMs - new Date(lastContactedAt).getTime()) / DAY_MS);
    if (daysSince >= 14) {
      return { label: `Needs follow-up (${daysSince}d silence)`, tone: "stop" };
    }
    if (daysSince >= 7) {
      return { label: `Follow-up due (${daysSince}d since intro)`, tone: "hold" };
    }
    return { label: `Awaiting reply (sent ${daysSince === 0 ? "today" : `${daysSince}d ago`})`, tone: "hold" };
  }

  if (outreachStatus === "follow_up_sent") {
    if (!lastContactedAt) return { label: "Follow-up sent", tone: "hold" };
    const daysSince = Math.floor((nowMs - new Date(lastContactedAt).getTime()) / DAY_MS);
    if (daysSince >= 14) {
      return { label: `Needs decision (${daysSince}d since follow-up)`, tone: "stop" };
    }
    if (daysSince >= 7) {
      return { label: `Follow-up due (${daysSince}d silence)`, tone: "hold" };
    }
    return { label: `Awaiting reply (follow-up ${daysSince === 0 ? "today" : `${daysSince}d ago`})`, tone: "hold" };
  }

  if (outreachStatus === "responded") {
    if (lastReplyAt) {
      const daysSince = Math.floor((nowMs - new Date(lastReplyAt).getTime()) / DAY_MS);
      return { label: `Replied ${daysSince === 0 ? "today" : `${daysSince}d ago`}`, tone: "go" };
    }
    return { label: "Client responded", tone: "go" };
  }

  if (outreachStatus === "converted") {
    return { label: "Converted client", tone: "go" };
  }

  return null;
}

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
  const [client, owner, suppression, { score }, stats, identifiers, { sources }, latestFinancial] =
    await Promise.all([
      loadClient(organisationId),
      loadOwner(organisationId),
      loadSuppression(organisationId),
      loadScore(organisationId),
      loadRecordStats(organisationId),
      loadIdentifiers(organisationId),
      loadSources(organisationId),
      loadLatestFinancial(organisationId),
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

  // How deep the dossier goes, in four ticks. Every input is already loaded
  // above, so the strip adds nothing to this render's query budget.
  const completeness = buildCompleteness({
    identifierCount: identifiers.length,
    filingCount: stats.filings,
    headcountFilingCount: stats.headcountFilings,
    grantCount: stats.grants,
  });

  const financialScale = formatFinancialScale(latestFinancial);
  const lastContactedText = formatLastContacted(stats.lastContactedAt, stats.emailsSent);
  const dateAddedText = formatDateAdded(client.created_at);
  const operationalInsight = getOperationalInsights(
    client.outreach_status,
    stats.lastContactedAt,
    stats.lastReplyAt,
  );

  return (
    <div className="relative rounded-panel border border-rule bg-white">
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

      {/* `items-start`, deliberately. Stretching this row was tried and reverted:
          the dial column runs a long way taller than the identity column, so
          handing that slack to the identity column's last child inflated the
          provenance panel into a ~300px grey box around two lines of text. Slack
          under a short column reads as margin; slack *inside* a filled panel
          reads as a mistake. The panel keeps its natural height. */}
      <div className="grid items-start gap-x-8 gap-y-4 px-5 pt-5 pb-1 lg:grid-cols-[minmax(0,1fr)_auto]">
        <div className="flex min-w-0 flex-col gap-3">
          <h1 className="font-body text-[clamp(2rem,4vw,2.75rem)] font-semibold leading-[1] tracking-[-0.03em] text-balance text-ink">
            {toTitleCase(client.legal_name)}
          </h1>

          <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[13.5px] text-dim">
            <span className="capitalize">{headerOrganisationType(client.organisation_type)}</span>
            <span aria-hidden="true" className="text-rule">
              ·
            </span>
            <span className="inline-flex items-center gap-1">
              <MapPin aria-hidden="true" className="size-3.5 shrink-0 text-faint" />
              <span>{headerLocation(client)}</span>
            </span>
            {client.sector && (
              <>
                <span aria-hidden="true" className="text-rule">
                  ·
                </span>
                <span className="font-medium text-ink/85">{toTitleCase(client.sector)}</span>
              </>
            )}
            {financialScale && (
              <>
                <span aria-hidden="true" className="text-rule">
                  ·
                </span>
                <span className="rounded-[4px] bg-emerald-500/[0.08] px-2 py-0.5 text-[12.5px] font-medium text-emerald-800">
                  {financialScale}
                </span>
              </>
            )}
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

          {/* Where this record stands in the pipeline. The cadence facts that
              used to sit beside it — last contacted, date added — now live under
              the dial, so this row carries only the call to act. */}
          {operationalInsight && (
            <div className="flex flex-wrap items-center gap-2 pt-0.5 text-[12px]">
              <Pill tone={operationalInsight.tone}>{operationalInsight.label}</Pill>
            </div>
          )}

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

          {/* What is held, and what is not. Sits under the docket because it is
              the same question one step out: the docket says which registers
              vouch for this record, the strip says how much of the record they
              actually filled in. */}
          <CompletenessTicks className="pt-2.5 sm:pt-3" completeness={completeness} />

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
                ? formatShortDate(lastMs)
                : null;
              return (
                <p className="mt-5 flex max-w-[58ch] items-center gap-3 rounded-inset bg-paper px-4 py-3 text-[13.5px] leading-[1.6] text-dim">
                  <svg
                    aria-hidden="true"
                    className="size-[17px] shrink-0 text-faint"
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
                      href={`/clients/${organisationId}/activity#wfww-heading`}
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
            a box around a circle. The column stretches to the identity block's
            height, so the dial owns all of the vertical space on the right. */}
        <div className="flex shrink-0 items-center justify-center self-end pb-0">
          <PriorityDial
            band={score?.priority_band ?? null}
            factors={score?.score_factors ?? null}
            score={score?.priority_score ?? null}
          />
        </div>
      </div>

      {/* Owner and stage — the two things a CAM changes — and, pushed to the
          far end of the same row, the cadence facts that used to sit up in the
          identity block. They read as status rather than identity, and putting
          them here fills the run of empty space under the dial. */}
      <div className="relative z-20 flex flex-wrap items-center gap-x-7 gap-y-2 border-t border-rule-soft px-5 py-2.5">
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

        <div className="ml-auto flex flex-wrap items-center gap-2 text-[12px]">
          <span
            className="inline-flex items-center gap-1.5 rounded-inset border border-rule-soft bg-paper px-2.5 py-1 text-dim"
            title={stats.lastContactedAt ? `Last outreach sent: ${new Date(stats.lastContactedAt).toLocaleString("en-GB")}` : undefined}
          >
            <Mail className="size-3.5 shrink-0 text-faint" />
            <span>{lastContactedText}</span>
          </span>

          {dateAddedText && (
            <span
              className="inline-flex items-center gap-1.5 rounded-inset border border-rule-soft bg-paper px-2.5 py-1 text-dim"
              title={client.created_at ? `Record created: ${new Date(client.created_at).toLocaleString("en-GB")}` : undefined}
            >
              <Calendar className="size-3.5 shrink-0 text-faint" />
              <span>{dateAddedText}</span>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
