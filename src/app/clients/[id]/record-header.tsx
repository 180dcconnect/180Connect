import { ExternalLink, Globe, Mail } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { reportError } from "@/lib/error-logging";
import { hasPermission } from "@/lib/auth/permissions";
import { validateClientEmail } from "@/lib/client-email-validation";
import { websiteHref } from "@/lib/website-validation";
import { formatLocation, formatOrganisationType, formatOutreachStatus } from "@/lib/organisation-format";
import { checkOwnershipConflict } from "@/lib/outreach/ownership-conflict";
import type { OwnershipRequestStatus } from "@/lib/ownership-requests";
import { BackButton } from "@/components/ui/back-button";

import {
  loadClient,
  loadOwner,
  loadRecordStats,
  loadScore,
  loadSuppression,
  loadWebsite,
  requireActor,
} from "./load-record";
import { OwnerControl, HeaderControlShell } from "./owner-control";
import { RecordMenu } from "./record-menu";
import { StatusSelect } from "./status-select";

/**
 * The record's persistent header: who this client is, who owns it, where it sits
 * in the pipeline, and the five numbers worth knowing before reading anything
 * else. It renders once in `layout.tsx` and stays put while the tabs change
 * underneath it.
 *
 * The charcoal band is kept from the previous design — it is the product's
 * signature surface, shared with the client list's bulk-actions bar and search
 * bar. What changed is that it now *does* things. Ownership, pipeline status and
 * the do-not-contact flag were three cards in a right-hand column, which meant a
 * CAM scrolled past the record to change the record. They are controls up here
 * now, and the three cards are gone.
 *
 * Still a server component: everything interactive is a client child
 * (`OwnerControl`, `StatusSelect`, `RecordMenu`), so the band's markup — the
 * blurs, the monogram, the stat tiles — never reaches the browser bundle.
 */

/** First letters of the first two words — the hero monogram and owner chip. */
function initialsOf(name: string | null | undefined): string {
  return (name ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join("");
}

/**
 * One tile in the at-a-glance band. Glass on charcoal so the record's five
 * headline numbers read as part of the profile card itself, not as a second row
 * of white cards below it. `accent` (the priority score — the one number that
 * drives queue order) tints lime, echoing the page's single accent.
 */
function HeroStat({
  label,
  value,
  sub,
  accent = false,
}: {
  label: string;
  value: string;
  sub?: string | null;
  accent?: boolean;
}) {
  return (
    <div className={`px-5 py-4 ${accent ? "bg-[#e6f5c0]/[0.09]" : "bg-[#1c1a18]"}`}>
      <p className="text-[10px] font-bold tracking-[0.14em] text-[#f4f4ef]/40 uppercase">
        {label}
      </p>
      <p
        className={`mt-1 truncate text-xl font-black tabular-nums ${
          accent ? "text-[#e6f5c0]" : "text-[#f4f4ef]"
        }`}
      >
        {value}
      </p>
      {sub && (
        <p className="mt-0.5 truncate text-[11px] leading-[1.4] text-[#f4f4ef]/35">{sub}</p>
      )}
    </div>
  );
}

export async function RecordHeader({ organisationId }: { organisationId: string }) {
  const actor = await requireActor();
  const [client, owner, suppression, { score }, stats] = await Promise.all([
    loadClient(organisationId),
    loadOwner(organisationId),
    loadSuppression(organisationId),
    loadScore(organisationId),
    loadRecordStats(organisationId),
  ]);

  const website = await loadWebsite(client.website);
  // Never `href={website.url}`: on the invalid branch that field is the raw
  // stored text, and a browser resolves a scheme-less string as a path.
  const websiteLink = websiteHref(website);
  const email = validateClientEmail(client.contact_email);

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

  // F163: admin's CAM picker, only fetched for an admin — nobody else can reach
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

  const clientInitials = initialsOf(client.legal_name) || "?";
  const statusLabel = formatOutreachStatus(client.outreach_status);
  const lastActivity = stats.lastActivity
    ? new Date(stats.lastActivity).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : null;

  return (
    <div className="relative overflow-hidden rounded-3xl bg-[#1c1a18] text-[#f4f4ef] shadow-[0_24px_60px_-28px_rgba(28,26,24,0.65)] ring-1 ring-black/30">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -top-36 -right-24 size-96 rounded-full bg-[#e6f5c0]/[0.14] blur-3xl" />
        <div className="absolute -bottom-24 -left-16 size-72 rounded-full bg-brand/25 blur-3xl" />
        {/* The monogram writ large — editorial texture behind the record,
            clipped by the band's rounded corner. 5% lime over charcoal is a
            watermark, not a second accent. */}
        <span className="absolute -right-2 -bottom-10 text-[4.5rem] leading-none font-black tracking-[-0.06em] text-[#e6f5c0]/[0.05] select-none sm:right-4 sm:text-[9rem] lg:text-[11rem]">
          {clientInitials}
        </span>
      </div>

      <div className="relative flex items-center justify-between gap-3 px-6 pt-5 sm:px-8">
        <BackButton variant="sliding-door" tone="dark" size="sm" href="/clients" />
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

      <div className="relative flex flex-wrap items-start justify-between gap-x-8 gap-y-6 px-6 py-7 sm:px-8">
        <div className="flex min-w-0 items-start gap-4 sm:gap-5">
          <span
            aria-hidden="true"
            className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-[#e6f5c0] text-xl font-black tracking-tight text-[#10130c] shadow-[inset_0_1px_0_rgba(255,255,255,0.4),0_0_0_1px_rgba(230,245,192,0.25)] sm:size-16 sm:text-2xl"
          >
            {clientInitials}
          </span>
          <div className="min-w-0">
            <p className="text-[10px] font-bold tracking-[0.16em] text-[#f4f4ef]/40 uppercase">
              Client record
            </p>
            <h1 className="mt-1.5 font-body text-[clamp(2rem,4.5vw,3.25rem)] leading-[1.02] font-black tracking-[-0.04em]">
              {client.legal_name}
            </h1>
            {/* The record's identity in one line of glass markers: what it is,
                where it is, and the two states that change what anyone is
                allowed to do with it. */}
            <div className="mt-3.5 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center rounded-full bg-white/[0.08] px-3 py-1 text-[10px] font-bold tracking-[0.1em] text-[#f4f4ef]/70 uppercase ring-1 ring-white/10">
                {formatOrganisationType(client.organisation_type)}
              </span>
              <span className="inline-flex items-center rounded-full bg-white/[0.08] px-3 py-1 text-[10px] font-bold tracking-[0.1em] text-[#f4f4ef]/70 uppercase ring-1 ring-white/10">
                {formatLocation(client)}
              </span>
              {suppression.suppressed ? (
                <span className="inline-flex items-center rounded-full bg-red-500/20 px-3 py-1 text-[10px] font-bold tracking-[0.1em] text-red-100 uppercase ring-1 ring-red-400/30">
                  {statusLabel}
                </span>
              ) : (
                <span className="inline-flex items-center rounded-full bg-[#e6f5c0] px-3 py-1 text-[10px] font-bold tracking-[0.1em] text-[#10130c] uppercase shadow-[inset_0_1px_0_rgba(255,255,255,0.35)]">
                  {statusLabel}
                </span>
              )}
              {suppression.suppressed && (
                <span className="inline-flex items-center rounded-full bg-red-500/20 px-3 py-1 text-[10px] font-bold tracking-[0.1em] text-red-100 uppercase ring-1 ring-red-400/30">
                  Do not contact
                </span>
              )}
              {suppression.suppressionPending && (
                <span className="inline-flex items-center rounded-full bg-amber-400/15 px-3 py-1 text-[10px] font-bold tracking-[0.1em] text-amber-200 uppercase ring-1 ring-amber-300/30">
                  DNC requested
                </span>
              )}
            </div>
            {/* Reach-me chips: only the channels that actually work — an invalid
                email or dead website gets no shortcut here; the Overview tab's
                Contactability card explains why. */}
            {(email.status === "valid" ||
              (websiteLink && website.status === "reachable")) && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {email.status === "valid" && (
                  <a
                    className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-white/[0.06] px-3 py-1.5 text-[12px] font-bold text-[#f4f4ef]/75 ring-1 ring-white/10 transition-colors hover:bg-white/[0.12] hover:text-[#f4f4ef] focus-visible:ring-2 focus-visible:ring-[#e6f5c0]/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#1c1a18] focus-visible:outline-none"
                    href={`mailto:${email.value ?? ""}`}
                  >
                    <Mail aria-hidden="true" className="size-3.5 shrink-0 opacity-70" />
                    <span className="truncate">{email.value}</span>
                  </a>
                )}
                {websiteLink && website.status === "reachable" && (
                  <a
                    className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-white/[0.06] px-3 py-1.5 text-[12px] font-bold text-[#f4f4ef]/75 ring-1 ring-white/10 transition-colors hover:bg-white/[0.12] hover:text-[#f4f4ef] focus-visible:ring-2 focus-visible:ring-[#e6f5c0]/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#1c1a18] focus-visible:outline-none"
                    href={websiteLink}
                    rel="noreferrer"
                    target="_blank"
                  >
                    <Globe aria-hidden="true" className="size-3.5 shrink-0 opacity-70" />
                    <span className="max-w-[16rem] truncate">{websiteLink}</span>
                    <ExternalLink aria-hidden="true" className="size-3 shrink-0 opacity-60" />
                  </a>
                )}
              </div>
            )}
          </div>
        </div>

        {/* The two things a CAM changes about a record most often, side by side
            and reachable from every tab. */}
        <div className="flex flex-wrap items-start gap-3">
          <OwnerControl
            canEdit={canEdit}
            isAdmin={isAdmin}
            isSelf={isSelf}
            organisationId={organisationId}
            ownerId={owner.ownerId}
            ownerInitials={initialsOf(owner.ownerName)}
            ownerName={owner.ownerName}
            team={team}
          />
          {canSetStatus && (
            <HeaderControlShell label="Pipeline status">
              <StatusSelect
                onDark
                currentStatus={client.outreach_status}
                organisationId={organisationId}
              />
            </HeaderControlShell>
          )}
        </div>
      </div>

      {/* At-a-glance band: the five numbers a CAM asks for before reading
          anything else. Glass tiles along the band's foot, hairline-separated.
          Score leads because it drives the queue order. */}
      <div className="relative grid grid-cols-2 gap-px border-t border-white/[0.08] bg-white/[0.08] sm:grid-cols-3 lg:grid-cols-5">
        <HeroStat
          accent={score?.priority_score != null}
          label="Priority score"
          sub={score?.priority_band ? `${score.priority_band} band` : "Not scored yet"}
          value={score?.priority_score != null ? score.priority_score.toFixed(2) : "—"}
        />
        <HeroStat
          label="Emails sent"
          sub="received by the client"
          value={String(stats.emailsSent)}
        />
        <HeroStat label="Replies" sub="back from the client" value={String(stats.replies)} />
        <HeroStat label="Notes" sub="on the record" value={String(stats.notes)} />
        <HeroStat
          label="Last activity"
          sub={lastActivity ? "most recent event" : "nothing yet"}
          value={lastActivity ?? "—"}
        />
      </div>
    </div>
  );
}
