import type { ReactNode } from "react";
import Link from "next/link";
import { Building2, FolderOpen, Paperclip, StickyNote, UserRound } from "lucide-react";

import { Pill } from "@/app/clients/[id]/section-card";
import { formatExactTime } from "@/lib/display-format";
import { intentLabel, statusLabel, statusTone } from "@/lib/inbox-labels";
import { formatDayCount, type RelationshipStats } from "@/lib/inbox-thread-context";
import type { Attachment } from "@/lib/attachments";
import type { DisplayNote } from "@/lib/note-history";
import type { TimelineEntry } from "@/lib/timeline";
import { ThreadNotesBlock } from "./thread-notes-block";

/**
 * Who this client is, who owns them, how long we have been talking, and what
 * has been written down — beside the conversation rather than a navigation
 * away from it.
 *
 * Every block is rendered from data the thread route already had to fetch or
 * from a shape an existing tested builder produced (@/lib/note-history,
 * @/lib/attachments, @/lib/timeline, @/lib/inbox-thread-context). This
 * component derives nothing itself; it is the layout, and its props are the
 * contract.
 *
 * A server component apart from the notes block, which is the one thing here
 * that writes.
 *
 * Sticky, and therefore NOT wrapped in `Rise`: `position: sticky` stops working
 * under any ancestor carrying a `transform` or a `filter`, and the entrance
 * variants apply both. search-rail.tsx's header documents the same trap at
 * length, as does the client page's anchor rail.
 */

/**
 * The rail's card: the app's card at rail scale.
 *
 * Deliberately not `SectionCard` — that one is sized for a 1.55fr column
 * (`px-5 py-4.5`, prose-width hints) and its title is the page's section
 * heading scale. This keeps the same three rules (`border-rule bg-white
 * rounded-panel`, no shadow) one notch smaller.
 *
 * What went: a `size-6 rounded-lg bg-black/[0.04] ring-1` icon tile around a
 * 14px glyph, and an `11px font-bold uppercase tracking-[0.12em]
 * text-foreground/40` eyebrow — caps at 40% opacity, the app's most-copied
 * mistake (docs/app-design-system.md §Type). Icons are inline in `text-faint`
 * and titles are sentence case at a real weight.
 */
function RailCard({
  title,
  icon,
  action,
  children,
}: {
  title: string;
  icon: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-panel border border-rule bg-white p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span aria-hidden="true" className="shrink-0 text-faint [&_svg]:size-[15px]">
            {icon}
          </span>
          <h2 className="truncate text-[13.5px] leading-[1.3] font-semibold tracking-[-0.01em] text-ink">
            {title}
          </h2>
        </div>
        {action}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

/** One label/value row. The label is what makes a bare date legible. */
function Fact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-[12.5px] text-dim">{label}</dt>
      <dd className="min-w-0 text-right text-[13px] font-semibold text-ink">{value}</dd>
    </div>
  );
}

function initialsOf(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return parts
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");
}

/** Date only — the rail has no room for times, and none of these need one. */
function dateOnly(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export type ThreadContextRailProps = {
  organisationId: string;
  organisationName: string;
  /** Formatted for display already — the route runs formatOrganisationType. */
  organisationType: string | null;
  location: string | null;
  /** An InboxThreadStatus token; unrecognised values render as themselves. */
  status: string;
  /** REPLY_EVENTS.intent of the newest reply, when there is one. */
  replyIntent: string | null;
  ownerName: string | null;
  /** Ownership handovers, newest first — built from audit_log by @/lib/timeline. */
  handovers: readonly TimelineEntry[];
  stats: RelationshipStats | null;
  notes: readonly DisplayNote[];
  noteCount: number;
  canAddNote: boolean;
  notesError: boolean;
  attachments: readonly Attachment[];
  attachmentsError: boolean;
};

export function ThreadContextRail({
  organisationId,
  organisationName,
  organisationType,
  location,
  status,
  replyIntent,
  ownerName,
  handovers,
  stats,
  notes,
  noteCount,
  canAddNote,
  notesError,
  attachments,
  attachmentsError,
}: ThreadContextRailProps) {
  return (
    <aside
      aria-label={`Client context for ${organisationName}`}
      className="space-y-4 lg:sticky lg:top-6"
    >
      <RailCard icon={<Building2 />} title="Client">
        <p className="text-sm leading-tight font-semibold text-ink">{organisationName}</p>
        <p className="mt-1 text-[12.5px] text-dim">
          {[organisationType, location].filter(Boolean).join(" · ") || "No profile details yet"}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <Pill tone={statusTone(status)}>{statusLabel(status)}</Pill>
          {replyIntent && (
            <Pill tone="lead" dot={false}>
              {intentLabel(replyIntent)}
            </Pill>
          )}
        </div>
        <Link
          className="mt-3 inline-block text-[12.5px] font-semibold text-lead underline underline-offset-2"
          href={`/clients/${organisationId}`}
        >
          Open client page →
        </Link>
      </RailCard>

      <RailCard icon={<UserRound />} title="Ownership">
        {ownerName ? (
          <div className="flex items-center gap-2.5">
            <span
              aria-hidden="true"
              className="grid size-8 shrink-0 place-items-center rounded-full bg-lead-wash text-[11px] font-semibold text-lead"
            >
              {initialsOf(ownerName)}
            </span>
            <p className="min-w-0 truncate text-[13px] font-semibold text-ink">{ownerName}</p>
          </div>
        ) : (
          <p className="text-[13px] leading-[1.6] text-dim">
            Unassigned — no CAM has claimed this client.
          </p>
        )}

        {/* There is no ownership_history table; these are audit_log rows read
            through @/lib/timeline's buildOwnershipReassignedEntry, which is
            what knows how to resolve a uuid that no longer has a user. */}
        {handovers.length > 0 && (
          <dl className="mt-3 space-y-2 border-t border-rule-soft pt-3">
            {handovers.map((entry) => (
              <div key={entry.id}>
                <p className="text-[12.5px] leading-[1.5] text-dim">
                  {entry.handover
                    ? `${entry.handover.fromName} → ${entry.handover.toName}`
                    : entry.summary}
                </p>
                <p className="mt-0.5 text-[11.5px] text-faint">
                  {dateOnly(entry.timestamp)}
                  {entry.handover?.reason ? ` · ${entry.handover.reason}` : ""}
                </p>
              </div>
            ))}
          </dl>
        )}
      </RailCard>

      {stats && (
        <RailCard icon={<FolderOpen />} title="Relationship">
          <dl className="space-y-2">
            {stats.firstContactAt && (
              <Fact label="First contacted" value={dateOnly(stats.firstContactAt)} />
            )}
            {stats.daysSinceFirstContact !== null && (
              <Fact label="Talking for" value={formatDayCount(stats.daysSinceFirstContact)} />
            )}
            <Fact
              label="Exchanged"
              value={`${stats.sentCount} sent · ${stats.replyCount} replied`}
            />
            <Fact label="Last activity" value={formatExactTime(new Date(stats.lastActivityAt))} />
          </dl>
          {/* The one fact the counts don't tell you: whether the ball is in
              their court, and for how long. Same condition threadStatus calls
              "awaiting". */}
          {stats.awaitingSince && (
            <p className="mt-3 rounded-inset bg-hold-wash px-3 py-2 text-[12.5px] leading-[1.5] font-semibold text-hold">
              Awaiting a reply for {formatDayCount(stats.daysSinceLastActivity)}.
            </p>
          )}
        </RailCard>
      )}

      <RailCard icon={<StickyNote />} title={`Notes${noteCount > 0 ? ` (${noteCount})` : ""}`}>
        <ThreadNotesBlock
          canAdd={canAddNote}
          error={notesError}
          notes={notes}
          organisationId={organisationId}
          totalCount={noteCount}
        />
      </RailCard>

      <RailCard
        icon={<Paperclip />}
        title={`Files${attachments.length > 0 ? ` (${attachments.length})` : ""}`}
      >
        {attachmentsError ? (
          <p className="text-[13px] font-semibold text-stop" role="alert">
            Files could not be loaded.
          </p>
        ) : attachments.length === 0 ? (
          <p className="text-[13px] leading-[1.6] text-dim">
            No files attached to this client.
          </p>
        ) : (
          <ul className="space-y-2">
            {attachments.map((attachment) => (
              <li key={attachment.id}>
                {/* The bucket is private: this route exchanges the row for a
                    short-lived signed URL and redirects. Same link the client
                    page's AttachmentsSection uses — signed URLs are never
                    stored or built here. */}
                <a
                  className="block break-all text-[13px] font-semibold text-lead underline underline-offset-2"
                  href={`/api/clients/${organisationId}/attachments/${attachment.id}/download`}
                  rel="noreferrer"
                  target="_blank"
                >
                  {attachment.filename}
                </a>
                <p className="mt-0.5 text-[11.5px] text-faint">
                  {attachment.uploadedByName}
                  {attachment.sizeLabel ? ` · ${attachment.sizeLabel}` : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
      </RailCard>
    </aside>
  );
}
