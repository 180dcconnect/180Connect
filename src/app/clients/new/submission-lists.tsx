import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, X } from "lucide-react";

import { InlineAlert } from "@/components/ui/inline-alert";
import { Pill } from "../[id]/section-card";
import { DraftRows } from "./draft-rows";
import type { ManualEntryDraft } from "./manual-entry-form";

export type RecentSubmission = {
  id: string;
  legal_name: string | null;
  review_status: "pending" | "approved" | "rejected";
  converted_to_organisation_id: string | null;
  updated_at: string;
};

/**
 * "Added", not "Approved": for an admin there was never an approval to speak
 * of — their submission goes straight onto the client list — and for a CAM the
 * outcome they care about is the same one.
 */
const STATUS_PILL: Record<RecentSubmission["review_status"], { tone: "hold" | "go" | "stop"; label: string }> = {
  pending: { tone: "hold", label: "Awaiting review" },
  approved: { tone: "go", label: "Added" },
  rejected: { tone: "stop", label: "Not added" },
};

function when(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

const CARD = "overflow-hidden rounded-panel border border-rule bg-white";
const HEADING = "font-body text-[18px] leading-[1.3] font-semibold tracking-[-0.01em] text-ink";

/**
 * The landing view's lists — what was added recently, and drafts still in hand.
 *
 * The same shape as the Charity Commission screen's recent imports: history is
 * the page, and starting a new one is the action on its header. Two cards
 * rather than one mixed list, because the rows answer different questions — a
 * draft is something you can still open; an added client is somewhere to go.
 */
export function RecentlyAdded({
  recent,
  isAdmin,
  action,
  highlightId,
}: {
  recent: RecentSubmission[];
  isAdmin: boolean;
  /** The screen's primary action, from the shell that owns the mode. */
  action: ReactNode;
  /**
   * The entry the composer just submitted (`?added=`). It gets a line at the
   * top saying where it went, with the way to it, and its row is marked — the
   * form closes on success, so this is the only place the outcome is said.
   */
  highlightId?: string | null;
}) {
  const awaiting = recent.filter((entry) => entry.review_status === "pending").length;
  const added = highlightId ? recent.find((entry) => entry.id === highlightId) : undefined;
  const addedHref =
    added?.review_status === "approved" && added.converted_to_organisation_id
      ? `/clients/${added.converted_to_organisation_id}`
      : null;

  return (
    <section aria-labelledby="recent-heading" className={CARD}>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 px-5 py-4">
        <div>
          <h2 className={HEADING} id="recent-heading">
            {isAdmin ? "Recently added" : "Your submissions"}
          </h2>
          {/* An admin's entries only wait when something went wrong — a possible
              duplicate, a failed activation — so the count shows only when it is
              not zero, and then it is worth reading. */}
          {awaiting > 0 && (
            <p className="mt-0.5 text-[13px] text-hold">
              {isAdmin ? (
                <>
                  {awaiting} {awaiting === 1 ? "needs a decision" : "need decisions"} in{" "}
                  <Link className="font-semibold underline underline-offset-2" href="/admin/manual-entries">
                    manual entries
                  </Link>
                </>
              ) : (
                <>{awaiting} awaiting an admin&rsquo;s review</>
              )}
            </p>
          )}
        </div>
        {action}
      </div>

      {added && (
        <div
          className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-lead/15 bg-lead-wash px-5 py-3"
          role="status"
        >
          <p className="text-[13px] leading-[1.6] text-ink">
            <span className="font-semibold text-lead">{added.legal_name || "The client"}</span>{" "}
            {added.review_status === "approved"
              ? "is on the client list."
              : added.review_status === "pending"
                ? isAdmin
                  ? "was saved, but needs a decision in manual entries before it joins the client list."
                  : "was sent to an admin for review."
                : "was not added."}
          </p>
          <span className="flex items-center gap-3">
            {addedHref && (
              <Link
                className="group inline-flex items-center gap-1 text-[13px] font-semibold text-lead hover:underline"
                href={addedHref}
              >
                View client
                <ArrowRight aria-hidden className="size-3.5 transition-transform group-hover:translate-x-0.5" />
              </Link>
            )}
            <Link
              aria-label="Dismiss"
              className="inline-flex size-6 items-center justify-center rounded-inset text-lead/70 transition-colors hover:text-lead"
              href="/clients/new"
              scroll={false}
            >
              <X aria-hidden className="size-3.5" strokeWidth={2.4} />
            </Link>
          </span>
        </div>
      )}

      {recent.length === 0 ? (
        <div className="border-t border-rule-soft px-5 py-10 text-center">
          <p className="font-body text-[15px] font-semibold text-ink">Nothing added yet</p>
          <p className="mx-auto mt-1.5 max-w-sm text-[13px] leading-[1.6] text-dim">
            {isAdmin
              ? "Clients you add here appear in this list, with a link to each."
              : "What you submit appears here, with where it got to."}
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-rule-soft border-t border-rule-soft">
          {recent.map((entry) => {
            const pill = STATUS_PILL[entry.review_status];
            const name = entry.legal_name || "Untitled client";
            const href =
              entry.review_status === "approved" && entry.converted_to_organisation_id
                ? `/clients/${entry.converted_to_organisation_id}`
                : null;
            return (
              <li
                className={`flex flex-wrap items-center gap-x-4 gap-y-1.5 px-5 py-3 ${entry.id === highlightId ? "bg-lead-wash/50" : ""}`}
                key={entry.id}
              >
                <span className="w-28 shrink-0 text-[12.5px] tabular-nums text-dim">{when(entry.updated_at)}</span>
                {href ? (
                  <Link className="min-w-0 flex-1 truncate text-sm font-semibold text-lead hover:underline" href={href}>
                    {name}
                  </Link>
                ) : (
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">{name}</span>
                )}
                {entry.id === highlightId && (
                  <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-lead">New</span>
                )}
                <Pill tone={pill.tone}>{pill.label}</Pill>
              </li>
            );
          })}
        </ul>
      )}

      <div className="border-t border-rule-soft px-5 py-3">
        <Link className="group inline-flex items-center gap-1 text-[13px] font-semibold text-lead hover:underline" href="/clients">
          All clients
          <ArrowRight aria-hidden className="size-3.5 transition-transform group-hover:translate-x-0.5" />
        </Link>
      </div>
    </section>
  );
}

export function DraftList({
  drafts,
  draftLoadMessage,
}: {
  drafts: ManualEntryDraft[];
  draftLoadMessage: string | null;
}) {
  return (
    <section aria-labelledby="drafts-heading" className={CARD}>
      <div className="px-5 py-4">
        <h2 className={HEADING} id="drafts-heading">
          Drafts
        </h2>
        <p className="mt-0.5 text-[13px] text-dim">Clients you started and saved to finish later.</p>
      </div>

      {draftLoadMessage ? (
        <div className="border-t border-rule-soft px-5 py-4">
          <InlineAlert variant="inline" tone="error" message={draftLoadMessage} />
        </div>
      ) : drafts.length === 0 ? (
        <p className="border-t border-rule-soft px-5 py-4 text-[13px] text-dim">
          No drafts. <span className="text-ink">Save draft</span> on the form keeps one here.
        </p>
      ) : (
        <DraftRows
          rows={drafts.map((draft) => ({
            id: draft.id,
            name: draft.legal_name || "Untitled client",
            date: when(draft.updated_at),
            fromWebsite: Boolean(draft.source_url),
          }))}
        />
      )}
    </section>
  );
}
