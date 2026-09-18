"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Check,
  ChevronDown,
  ChevronsUpDown,
  FileEdit,
  History,
  Loader2,
  Undo2,
  X,
} from "lucide-react";
import { CheckTheSource } from "@/components/check-the-source";
import { InlineAlert } from "@/components/ui/inline-alert";
import { Pill } from "@/app/(app)/clients/[id]/section-card";
import { BrandSearchBar, type FilterOption } from "@/components/brand/search-bar";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/animate-ui/components/radix/dialog";
import { FeedPagination } from "@/components/ui/feed-pagination";
import {
  OrganisationHoverCard,
  type OrganisationPreview,
} from "@/components/organisation-hover-card";
import {
  proposedChangeLabel,
  restrictedFieldLabel,
  type EditSuggestionRow,
} from "@/lib/edit-suggestions";

const FIELD_FILTER_CATEGORY = "Filter by field";
const OUTCOME_FILTER_CATEGORY = "Filter by decision";
const REVIEWER_FILTER_CATEGORY = "Filter by reviewer";
const PROPOSER_FILTER_CATEGORY = "Filter by proposer";

type AppliedSearchFilter = FilterOption & { category: string };
import type { OrganisationSource } from "@/lib/organisation-source-links";
import { VIEW_ONLY_CONTROL_NOTE } from "@/lib/auth/view-only";
import { decideEditSuggestionAction } from "./actions";

type ApprovalTab = "pending" | "history";
type PillTone = "go" | "hold" | "stop" | "neutral";

const STATUS_LABEL: Record<EditSuggestionRow["status"], string> = {
  pending: "Pending review",
  approved: "Approved",
  rejected: "Rejected",
  superseded: "Replaced",
};

const STATUS_TONE: Record<EditSuggestionRow["status"], PillTone> = {
  pending: "hold",
  approved: "go",
  rejected: "stop",
  superseded: "neutral",
};

function personLabel(person: { full_name: string | null; email: string } | null) {
  if (!person) return "Unknown team member";
  return person.full_name ?? person.email;
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function DisplayValue({ value }: { value: string | null }) {
  return value ? (
    <span>{value}</span>
  ) : (
    <span className="italic text-faint">Not provided</span>
  );
}

function buildClientPreview(row: EditSuggestionRow): OrganisationPreview {
  return {
    id: row.organisation_id,
    legalName: row.organisations?.legal_name ?? "Unknown client",
    organisationType: null,
    sector: null,
    city: null,
    countryCode: null,
    outreachStatus: "not_contacted",
    website: row.organisations?.website ?? null,
    ownerId: null,
    ownerName: null,
    ownerEmail: null,
  };
}

function formatRelativeDateGroup(dateString: string | null): string {
  if (!dateString) return "Earlier decisions";
  const date = new Date(dateString);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const itemDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffTime = today.getTime() - itemDate.getTime();
  const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));

  if (diffDays <= 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return "This week";
  if (diffDays < 30) return "This month";
  return date.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
}

/**
 * One proposed change, read the way an incomplete record is: the top line is the
 * whole card's handle — tap it and the card folds — and the values and the
 * decision controls sit underneath.
 *
 * Admins work down a queue of proposals that all look alike, and an eight-card
 * queue of expanded cards buries the next unanswered one below the fold. Folding
 * the ones already read is what keeps the queue scannable; nothing is decided
 * for them, and the status pill, the sources and the client stay on the closed
 * header.
 */
function PendingSuggestionCard({
  row,
  canDecide,
  decisionInFlight,
  source,
  onApprove,
  onReject,
}: {
  row: EditSuggestionRow;
  canDecide: boolean;
  /** Which decision is running for this card, or null when it is idle. */
  decisionInFlight: "approve" | "reject" | null;
  /** Register numbers and website behind the "Check the source" row. */
  source: OrganisationSource;
  onApprove: (customProposedValue?: string) => void;
  onReject: () => void;
}) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [isEditingProposed, setIsEditingProposed] = useState(false);
  const [editedProposedValue, setEditedProposedValue] = useState(row.proposed_value);
  const fieldLabel = restrictedFieldLabel(row.field_name);
  const clientName = row.organisations?.legal_name ?? "Unknown client";
  const headingId = `suggestion-${row.id}`;
  const detailsId = `${headingId}-details`;
  const isBusy = decisionInFlight !== null;
  const approving = decisionInFlight === "approve";

  return (
    <li>
      <article
        aria-labelledby={headingId}
        className="rounded-panel border border-rule bg-white px-5 py-5 sm:px-6"
      >
        {/* 1 — who this is, and the readings that answer it at its origin */}
        <header>
          <div
            onClick={(event) => {
              if ((event.target as HTMLElement).closest("a, button, input, textarea, select")) {
                return;
              }
              const selection = window.getSelection();
              if (selection && selection.toString().trim().length > 0) {
                return;
              }
              setIsExpanded((expanded) => !expanded);
            }}
            className="flex cursor-pointer flex-wrap items-start justify-between gap-x-4 gap-y-2"
          >
            <div className="min-w-0">
              <h2
                id={headingId}
                className="font-body text-[20px] font-semibold leading-[1.25] tracking-[-0.015em] text-ink"
              >
                <OrganisationHoverCard
                  org={buildClientPreview(row)}
                  href={`/clients/${row.organisation_id}`}
                  className="transition-colors hover:text-lead hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lead/30"
                >
                  {clientName}
                </OrganisationHoverCard>
              </h2>
              <p className="mt-1 text-[13px] leading-[1.55] text-dim">
                Proposed by {personLabel(row.requested_by_user)} on{" "}
                {formatDateTime(row.created_at)}
              </p>
            </div>

            <div className="flex max-w-full flex-wrap items-center justify-end gap-x-2.5 gap-y-1.5">
              <Pill tone="hold">Pending review</Pill>
              <CheckTheSource source={source} />
              <Link
                href={`/clients/${row.organisation_id}`}
                className="text-[13px] font-medium text-lead hover:underline"
              >
                Open profile
              </Link>
              <button
                type="button"
                aria-expanded={isExpanded}
                aria-controls={detailsId}
                aria-label={`${isExpanded ? "Hide" : "Show"} details for ${clientName}`}
                onClick={() => setIsExpanded((expanded) => !expanded)}
                className="inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-inset text-dim transition-colors hover:bg-paper hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lead/30"
              >
                <ChevronDown
                  aria-hidden="true"
                  className={`size-4 transition-transform duration-200 ${isExpanded ? "rotate-180" : ""}`}
                />
              </button>
            </div>
          </div>
        </header>

        <div
          id={detailsId}
          aria-hidden={!isExpanded}
          inert={!isExpanded}
          data-expanded={isExpanded}
          className="card-collapse-grid"
        >
          <div>
            <div className="border-t border-rule-soft mt-4 pt-4">
              <div className="flex items-center gap-2 text-[13.5px] font-semibold text-ink">
                <FileEdit className="size-[15px] text-faint" aria-hidden="true" />
                {row.proposed_absent
                  ? "Proposed change: this client has no website"
                  : `Proposed change: ${fieldLabel}`}
              </div>

          <dl className="mt-3 grid overflow-hidden rounded-inset border border-rule-soft bg-paper sm:grid-cols-2">
            <div className="p-4">
              <dt className="text-[12.5px] font-medium text-dim">Current live value</dt>
              <dd className="mt-1 break-words text-sm font-medium leading-[1.55] text-ink">
                <DisplayValue value={row.current_value} />
              </dd>
            </div>
            <div className="border-t border-rule-soft bg-lead-wash/55 p-4 sm:border-t-0 sm:border-l">
              <div className="flex items-center justify-between gap-2">
                <dt className="text-[12.5px] font-medium text-lead">
                  {row.proposed_absent ? "What approving does" : "Proposed value"}
                </dt>
                {/* No value to edit on an absence proposal — it claims the field
                    should stay empty, so there is nothing to type over. */}
                {canDecide && !isEditingProposed && !row.proposed_absent && (
                  <button
                    type="button"
                    onClick={() => setIsEditingProposed(true)}
                    className="cursor-pointer text-[12px] font-semibold text-lead underline hover:text-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-lead/30"
                  >
                    Edit
                  </button>
                )}
              </div>
              {isEditingProposed ? (
                <div className="mt-2 space-y-2">
                  <input
                    type="text"
                    value={editedProposedValue}
                    onChange={(e) => setEditedProposedValue(e.target.value)}
                    aria-label={`Edit proposed value for ${fieldLabel}`}
                    className="w-full rounded-inset border border-lead bg-white px-2.5 py-1.5 text-sm font-semibold text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lead/30"
                  />
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setIsEditingProposed(false)}
                      className="cursor-pointer rounded-inset bg-lead px-2.5 py-0.5 text-xs font-semibold text-white hover:bg-lead-mid"
                    >
                      Done
                    </button>
                    {editedProposedValue !== row.proposed_value && (
                      <button
                        type="button"
                        onClick={() => {
                          setEditedProposedValue(row.proposed_value);
                          setIsEditingProposed(false);
                        }}
                        className="cursor-pointer text-xs text-dim hover:text-ink"
                      >
                        Reset
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <dd className="mt-1 break-words text-sm font-semibold leading-[1.55] text-ink">
                  {row.proposed_absent
                    ? `Records that ${clientName} has no website, so the empty website stops counting as missing. Nothing is written into the website field.`
                    : editedProposedValue}
                  {!row.proposed_absent &&
                    editedProposedValue.trim() !== row.proposed_value.trim() && (
                      <span className="ml-2 inline-flex items-center rounded bg-lead/15 px-1.5 py-0.5 text-[11px] font-semibold text-lead">
                        Edited
                      </span>
                    )}
                </dd>
              )}
            </div>
          </dl>

          {canDecide && (
            <div className="mt-4 border-t border-rule-soft pt-4">
              <div className="flex flex-wrap items-center gap-2.5">
                <button
                  type="button"
                  disabled={
                    isBusy ||
                    (isEditingProposed && editedProposedValue.trim().length === 0)
                  }
                  onClick={() => {
                    const trimmed = editedProposedValue.trim();
                    const customValue =
                      trimmed.length > 0 && trimmed !== row.proposed_value
                        ? trimmed
                        : undefined;
                    onApprove(customValue);
                  }}
                  className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-inset border border-ink bg-ink px-3.5 text-[13px] font-semibold text-white transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lead/30 disabled:pointer-events-none disabled:opacity-50"
                >
                  {approving ? (
                    <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                  ) : (
                    <Check className="size-3.5" aria-hidden="true" />
                  )}
                  {approving ? "Applying change" : "Approve and apply"}
                </button>
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={onReject}
                  className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-inset border border-rule bg-white px-3.5 text-[13px] font-semibold text-stop transition-colors hover:border-stop/40 hover:bg-stop-wash focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stop/25 disabled:pointer-events-none disabled:opacity-50"
                >
                  <X className="size-3.5" aria-hidden="true" />
                  Reject
                </button>
              </div>
            </div>
          )}
            </div>
          </div>
        </div>
      </article>
    </li>
  );
}

function DecidedSuggestionCard({
  row,
  canDecide,
  isExpanded,
  onToggle,
}: {
  row: EditSuggestionRow;
  canDecide: boolean;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const fieldLabel = restrictedFieldLabel(row.field_name);
  const clientName = row.organisations?.legal_name ?? "Unknown client";
  const headingId = `decided-suggestion-${row.id}`;
  const detailsId = `${headingId}-details`;
  const approved = row.status === "approved";
  const rejected = row.status === "rejected";

  return (
    <li>
      <article
        aria-labelledby={headingId}
        className="rounded-panel border border-rule bg-white px-5 py-4 transition-colors hover:bg-paper/40 sm:px-6"
      >
        <header>
          <div
            onClick={(event) => {
              if ((event.target as HTMLElement).closest("a, button, input, textarea, select")) {
                return;
              }
              const selection = window.getSelection();
              if (selection && selection.toString().trim().length > 0) {
                return;
              }
              onToggle();
            }}
            className="flex cursor-pointer flex-wrap items-center justify-between gap-x-4 gap-y-2"
          >
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                <h3
                  id={headingId}
                  className="font-body text-[16px] font-semibold leading-[1.35] text-ink"
                >
                  <OrganisationHoverCard
                    org={buildClientPreview(row)}
                    href={`/clients/${row.organisation_id}`}
                    className="transition-colors hover:text-lead hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lead/30"
                  >
                    {clientName}
                  </OrganisationHoverCard>
                </h3>
                <span className="inline-flex items-center rounded-inset bg-paper px-2 py-0.5 text-xs font-medium text-dim">
                  {fieldLabel}
                </span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] leading-[1.5] text-dim">
                <span className="truncate max-w-[260px] sm:max-w-[400px]">
                  <span className="font-medium text-ink">{fieldLabel}: </span>
                  {approved ? (
                    <span className="font-medium text-go">{proposedChangeLabel(row)}</span>
                  ) : rejected ? (
                    <span className="line-through opacity-75">{proposedChangeLabel(row)}</span>
                  ) : (
                    <span>{proposedChangeLabel(row)}</span>
                  )}
                </span>
                <span className="text-rule">•</span>
                <span>
                  {row.decided_at ? (
                    <>
                      {approved ? "Approved" : rejected ? "Rejected" : "Superseded"}{" "}
                      {formatDateTime(row.decided_at)}
                      {row.decided_by_user && (
                        <> by {personLabel(row.decided_by_user)}</>
                      )}
                    </>
                  ) : (
                    <>Proposed by {personLabel(row.requested_by_user)} on {formatDateTime(row.created_at)}</>
                  )}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2.5">
              <Pill tone={STATUS_TONE[row.status]}>{STATUS_LABEL[row.status]}</Pill>
              <button
                type="button"
                aria-expanded={isExpanded}
                aria-controls={detailsId}
                aria-label={`${isExpanded ? "Hide" : "Show"} details for ${clientName}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggle();
                }}
                className="inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-inset text-dim transition-colors hover:bg-paper hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lead/30"
              >
                <ChevronDown
                  aria-hidden="true"
                  className={`size-4 transition-transform duration-200 ${isExpanded ? "rotate-180" : ""}`}
                />
              </button>
            </div>
          </div>
        </header>

        <div
          id={detailsId}
          aria-hidden={!isExpanded}
          inert={!isExpanded}
          data-expanded={isExpanded}
          className="card-collapse-grid"
        >
          <div>
            <div className="border-t border-rule-soft mt-3 pt-3">
              <dl className="grid items-stretch overflow-hidden rounded-inset bg-paper sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
                <div className="p-3.5">
                  <dt className="text-[12px] font-medium text-dim">
                    {approved ? "Previous value" : "Live value kept"}
                  </dt>
                  <dd className="mt-1 break-words text-[13.5px] font-medium leading-[1.5] text-ink">
                    <DisplayValue value={row.current_value} />
                  </dd>
                </div>
                <div className="hidden items-center border-x border-rule-soft px-3 text-faint sm:flex">
                  {approved ? (
                    <ArrowRight className="size-4 text-go" aria-hidden="true" />
                  ) : rejected ? (
                    <X className="size-4 text-stop" aria-hidden="true" />
                  ) : (
                    <History className="size-4 text-faint" aria-hidden="true" />
                  )}
                </div>
                <div
                  className={`border-t border-rule-soft p-3.5 sm:border-t-0 ${
                    approved
                      ? "bg-go-wash/50"
                      : rejected
                        ? "bg-stop-wash/45"
                        : "bg-paper-sunk/60"
                  }`}
                >
                  <dt
                    className={`text-[12px] font-medium ${
                      approved ? "text-go" : rejected ? "text-stop" : "text-dim"
                    }`}
                  >
                    {approved
                      ? "Applied value"
                      : rejected
                        ? "Suggested value not applied"
                        : "Earlier suggested value"}
                  </dt>
                  <dd className="mt-1 break-words text-[13.5px] font-semibold leading-[1.5] text-ink">
                    {proposedChangeLabel(row)}
                  </dd>
                </div>
              </dl>

              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] leading-[1.5] text-dim">
                <span>Proposed by {personLabel(row.requested_by_user)}</span>
                {row.decided_at && (
                  <span>
                    Decided {formatDateTime(row.decided_at)}
                    {row.decided_by_user && (
                      <> by {personLabel(row.decided_by_user)}</>
                    )}
                  </span>
                )}
              </div>

              {row.rejection_reason && (
                <div className="mt-3 rounded-inset border border-stop/20 bg-stop-wash/40 px-3.5 py-2.5">
                  <p className="text-[12px] font-semibold text-stop">Rejection reason</p>
                  <p className="mt-0.5 text-[13px] leading-[1.55] text-dim">
                    {row.rejection_reason}
                  </p>
                </div>
              )}

              <div className="mt-3">
                <Link
                  href={`/clients/${row.organisation_id}`}
                  className="inline-flex text-[13px] font-semibold text-lead transition-colors hover:text-lead-mid hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lead/30"
                >
                  {canDecide && approved
                    ? "Review or correct client record"
                    : "Open client record"}
                </Link>
              </div>
            </div>
          </div>
        </div>
      </article>
    </li>
  );
}

export function ApprovalsPanel({
  initialSuggestions,
  canDecide,
  sourceByOrganisation,
}: {
  initialSuggestions: EditSuggestionRow[];
  /**
   * Whether this reader may decide anything. False for leadership, who read the
   * queue and are offered no control in it — see `approval:manage` in
   * `src/lib/auth/permissions.ts`. The server refuses them either way; this is
   * so the page does not offer a button that can only fail.
   */
  canDecide: boolean;
  /**
   * What each card's "Check the source" row needs, keyed by organisation id:
   * the register numbers and the live website. Readings, not decisions, so a
   * viewer's cards carry them too — and a client with no number and no website
   * simply offers fewer links.
   */
  sourceByOrganisation: Record<string, OrganisationSource>;
}) {
  const [activeTab, setActiveTab] = useState<ApprovalTab>("pending");
  const [pending, setPending] = useState(() =>
    initialSuggestions.filter((row) => row.status === "pending"),
  );
  const [decided, setDecided] = useState(() =>
    initialSuggestions.filter((row) => row.status !== "pending"),
  );
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [rejectionTarget, setRejectionTarget] = useState<EditSuggestionRow | null>(null);
  const [rejectionError, setRejectionError] = useState<string | null>(null);
  const [busyDecision, setBusyDecision] = useState<{
    id: string;
    approve: boolean;
  } | null>(null);
  const [feedback, setFeedback] = useState<{
    type: "success" | "error" | "undone";
    message: string;
    canUndo?: boolean;
  } | null>(null);

  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function showFeedback(
    fb: {
      type: "success" | "error" | "undone";
      message: string;
      canUndo?: boolean;
    } | null,
    durationMs?: number,
  ) {
    if (feedbackTimerRef.current) {
      clearTimeout(feedbackTimerRef.current);
      feedbackTimerRef.current = null;
    }
    setFeedback(fb);
    if (fb && durationMs) {
      feedbackTimerRef.current = setTimeout(() => {
        setFeedback(null);
        feedbackTimerRef.current = null;
      }, durationMs);
    }
  }

  // Clear timers on unmount
  useEffect(() => {
    return () => {
      if (feedbackTimerRef.current) {
        clearTimeout(feedbackTimerRef.current);
      }
    };
  }, []);

  // History search, filter, grouping, and pagination states
  const [searchQuery, setSearchQuery] = useState("");
  const [searchFilters, setSearchFilters] = useState<AppliedSearchFilter[]>([]);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyPageSize, setHistoryPageSize] = useState(15);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const approvedCount = useMemo(
    () => decided.filter((row) => row.status === "approved").length,
    [decided],
  );
  const rejectedCount = useMemo(
    () => decided.filter((row) => row.status === "rejected").length,
    [decided],
  );
  const supersededCount = useMemo(
    () => decided.filter((row) => row.status === "superseded").length,
    [decided],
  );

  const searchCategories = useMemo<Record<string, FilterOption[]>>(() => {
    // 1. Decision outcome options
    const outcomeOptions: FilterOption[] = [
      { label: `Approved (${approvedCount})`, value: "approved" },
      { label: `Rejected (${rejectedCount})`, value: "rejected" },
    ];
    if (supersededCount > 0) {
      outcomeOptions.push({
        label: `Replaced (${supersededCount})`,
        value: "superseded",
      });
    }

    // 2. Field options
    const fieldCounts = new Map<string, number>();
    for (const row of decided) {
      if (row.field_name) {
        fieldCounts.set(row.field_name, (fieldCounts.get(row.field_name) ?? 0) + 1);
      }
    }
    const fieldOptions: FilterOption[] = Array.from(fieldCounts.entries())
      .map(([field, count]) => ({
        label: `${restrictedFieldLabel(field)} (${count})`,
        value: field,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));

    // 3. Reviewer options
    const reviewerCounts = new Map<string, number>();
    for (const row of decided) {
      if (row.decided_by_user) {
        const name = personLabel(row.decided_by_user);
        reviewerCounts.set(name, (reviewerCounts.get(name) ?? 0) + 1);
      }
    }
    const reviewerOptions: FilterOption[] = Array.from(reviewerCounts.entries())
      .map(([name, count]) => ({
        label: `${name} (${count})`,
        value: name,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));

    // 4. Proposer options
    const proposerCounts = new Map<string, number>();
    for (const row of decided) {
      if (row.requested_by_user) {
        const name = personLabel(row.requested_by_user);
        proposerCounts.set(name, (proposerCounts.get(name) ?? 0) + 1);
      }
    }
    const proposerOptions: FilterOption[] = Array.from(proposerCounts.entries())
      .map(([name, count]) => ({
        label: `${name} (${count})`,
        value: name,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));

    const cats: Record<string, FilterOption[]> = {
      [OUTCOME_FILTER_CATEGORY]: outcomeOptions,
      [FIELD_FILTER_CATEGORY]: fieldOptions,
    };
    if (reviewerOptions.length > 0) {
      cats[REVIEWER_FILTER_CATEGORY] = reviewerOptions;
    }
    if (proposerOptions.length > 0) {
      cats[PROPOSER_FILTER_CATEGORY] = proposerOptions;
    }
    return cats;
  }, [decided, approvedCount, rejectedCount, supersededCount]);

  const filteredDecisions = useMemo(() => {
    return decided.filter((row) => {
      // 1. Search bar category filters
      const outcomeFilters = searchFilters.filter((f) => f.category === OUTCOME_FILTER_CATEGORY);
      if (outcomeFilters.length > 0 && !outcomeFilters.some((f) => f.value === row.status)) {
        return false;
      }

      const fieldFilters = searchFilters.filter((f) => f.category === FIELD_FILTER_CATEGORY);
      if (fieldFilters.length > 0 && !fieldFilters.some((f) => f.value === row.field_name)) {
        return false;
      }

      const reviewerFilters = searchFilters.filter((f) => f.category === REVIEWER_FILTER_CATEGORY);
      if (
        reviewerFilters.length > 0 &&
        (!row.decided_by_user || !reviewerFilters.some((f) => f.value === personLabel(row.decided_by_user)))
      ) {
        return false;
      }

      const proposerFilters = searchFilters.filter((f) => f.category === PROPOSER_FILTER_CATEGORY);
      if (
        proposerFilters.length > 0 &&
        (!row.requested_by_user || !proposerFilters.some((f) => f.value === personLabel(row.requested_by_user)))
      ) {
        return false;
      }

      // 2. Free text search
      if (searchQuery.trim().length === 0) {
        return true;
      }
      const q = searchQuery.toLowerCase().trim();
      const clientName = (row.organisations?.legal_name ?? "").toLowerCase();
      const field = restrictedFieldLabel(row.field_name).toLowerCase();
      const proposed = (row.proposed_value ?? "").toLowerCase();
      const current = (row.current_value ?? "").toLowerCase();
      const requestedBy = personLabel(row.requested_by_user).toLowerCase();
      const decidedBy = row.decided_by_user
        ? personLabel(row.decided_by_user).toLowerCase()
        : "";
      const reason = (row.rejection_reason ?? "").toLowerCase();

      return (
        clientName.includes(q) ||
        field.includes(q) ||
        proposed.includes(q) ||
        current.includes(q) ||
        requestedBy.includes(q) ||
        decidedBy.includes(q) ||
        reason.includes(q)
      );
    });
  }, [decided, searchFilters, searchQuery]);

  const paginatedDecisions = useMemo(() => {
    const start = (historyPage - 1) * historyPageSize;
    return filteredDecisions.slice(start, start + historyPageSize);
  }, [filteredDecisions, historyPage, historyPageSize]);

  const groupedDecisions = useMemo(() => {
    const groups: { label: string; rows: EditSuggestionRow[] }[] = [];
    const groupMap = new Map<string, EditSuggestionRow[]>();

    for (const row of paginatedDecisions) {
      const label = formatRelativeDateGroup(row.decided_at ?? row.created_at);
      if (!groupMap.has(label)) {
        const list: EditSuggestionRow[] = [];
        groupMap.set(label, list);
        groups.push({ label, rows: list });
      }
      groupMap.get(label)!.push(row);
    }
    return groups;
  }, [paginatedDecisions]);

  const allVisibleExpanded =
    paginatedDecisions.length > 0 &&
    paginatedDecisions.every((d) => expandedIds.has(d.id));

  const toggleExpand = (id: string) => {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAllVisible = () => {
    if (allVisibleExpanded) {
      setExpandedIds((current) => {
        const next = new Set(current);
        for (const d of paginatedDecisions) next.delete(d.id);
        return next;
      });
    } else {
      setExpandedIds((current) => {
        const next = new Set(current);
        for (const d of paginatedDecisions) next.add(d.id);
        return next;
      });
    }
  };

  const pendingApprovalRef = useRef<{
    row: EditSuggestionRow;
    customProposedValue?: string;
    timeoutId: ReturnType<typeof setTimeout>;
  } | null>(null);

  async function executeApprovalCommit(
    row: EditSuggestionRow,
    customProposedValue?: string,
  ) {
    try {
      const result = await decideEditSuggestionAction({
        suggestionId: row.id,
        approve: true,
        proposedValue: customProposedValue,
      });

      if (!result.ok) {
        setPending((current) =>
          current.some((item) => item.id === row.id) ? current : [row, ...current],
        );
        showFeedback({ type: "error", message: result.error }, 6000);
        return;
      }

      const updatedRow: EditSuggestionRow = {
        ...row,
        proposed_value: customProposedValue ?? row.proposed_value,
        status: "approved",
        decided_at: new Date().toISOString(),
        rejection_reason: null,
      };
      setDecided((current) => [updatedRow, ...current.filter((item) => item.id !== row.id)]);
    } catch {
      setPending((current) =>
        current.some((item) => item.id === row.id) ? current : [row, ...current],
      );
      showFeedback(
        {
          type: "error",
          message: "The decision could not be saved. Check your connection and try again.",
        },
        6000,
      );
    }
  }

  async function flushPendingApproval() {
    if (!pendingApprovalRef.current) return;
    const { row, customProposedValue, timeoutId } = pendingApprovalRef.current;
    clearTimeout(timeoutId);
    pendingApprovalRef.current = null;
    await executeApprovalCommit(row, customProposedValue);
  }

  // Ensure any staged approval commits before unmounting
  useEffect(() => {
    return () => {
      if (pendingApprovalRef.current) {
        const { row, customProposedValue, timeoutId } = pendingApprovalRef.current;
        clearTimeout(timeoutId);
        void decideEditSuggestionAction({
          suggestionId: row.id,
          approve: true,
          proposedValue: customProposedValue,
        });
      }
    };
  }, []);

  function handleUndo() {
    if (!pendingApprovalRef.current) return;
    const { row, timeoutId } = pendingApprovalRef.current;
    clearTimeout(timeoutId);
    pendingApprovalRef.current = null;

    setPending((current) => {
      if (current.some((item) => item.id === row.id)) return current;
      return [row, ...current];
    });

    const clientName = row.organisations?.legal_name ?? "the client";
    showFeedback(
      {
        type: "undone",
        message: `Approval undone. The suggested change for ${clientName} is back in the queue.`,
        canUndo: false,
      },
      5000,
    );
  }

  async function handleDecision(
    row: EditSuggestionRow,
    approve: boolean,
    customProposedValue?: string,
  ) {
    if (approve) {
      if (pendingApprovalRef.current) {
        await flushPendingApproval();
      }

      showFeedback(null);
      setRejectionError(null);

      const effectiveRow = customProposedValue
        ? { ...row, proposed_value: customProposedValue }
        : row;

      // Optimistically remove from pending queue
      setPending((current) => current.filter((item) => item.id !== row.id));

      const clientName = effectiveRow.organisations?.legal_name ?? "the client";
      const fieldLabel = restrictedFieldLabel(effectiveRow.field_name);
      showFeedback(
        {
          type: "success",
          message: effectiveRow.proposed_absent
          ? `${clientName} is now recorded as having no website.`
          : `${fieldLabel} for ${clientName} was approved and applied to the live record.`,
          canUndo: true,
        },
        4500,
      );

      // 3.5 second window to allow user to undo before committing to the database
      const timeoutId = setTimeout(async () => {
        if (pendingApprovalRef.current?.row.id === effectiveRow.id) {
          pendingApprovalRef.current = null;
          await executeApprovalCommit(effectiveRow, customProposedValue);
        }
      }, 3500);

      pendingApprovalRef.current = {
        row: effectiveRow,
        customProposedValue,
        timeoutId,
      };
      return;
    }

    if (pendingApprovalRef.current) {
      await flushPendingApproval();
    }

    setBusyDecision({ id: row.id, approve: false });
    showFeedback(null);
    setRejectionError(null);
    const reasonText = reasons[row.id]?.trim() || undefined;

    try {
      const result = await decideEditSuggestionAction({
        suggestionId: row.id,
        approve: false,
        reason: reasonText,
      });

      if (!result.ok) {
        setRejectionError(result.error);
        return;
      }

      setPending((current) => current.filter((item) => item.id !== row.id));

      const updatedRow: EditSuggestionRow = {
        ...row,
        status: "rejected",
        decided_at: new Date().toISOString(),
        rejection_reason: reasonText ?? null,
      };
      setDecided((current) => [updatedRow, ...current]);

      const clientName = row.organisations?.legal_name ?? "the client";
      showFeedback(
        {
          type: "success",
          message: `The suggested change for ${clientName} was rejected. The live record was not changed.`,
          canUndo: false,
        },
        5000,
      );
      setRejectionTarget(null);
      setReasons((current) => {
        const next = { ...current };
        delete next[row.id];
        return next;
      });
    } catch {
      const message = "The decision could not be saved. Check your connection and try again.";
      setRejectionError(message);
    } finally {
      setBusyDecision(null);
    }
  }

  function switchTab(tab: ApprovalTab) {
    if (tab === "history" && pendingApprovalRef.current) {
      void flushPendingApproval();
    }
    setActiveTab(tab);
  }

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    let nextTab: ApprovalTab | null = null;
    if (event.key === "ArrowLeft" || event.key === "Home") nextTab = "pending";
    if (event.key === "ArrowRight" || event.key === "End") nextTab = "history";
    if (!nextTab) return;

    event.preventDefault();
    switchTab(nextTab);
    document.getElementById(`approvals-tab-${nextTab}`)?.focus();
  }

  return (
    <div className="space-y-6">
      {!canDecide && (
        <div className="rounded-inset bg-paper px-4 py-3">
          <p className="text-[13px] leading-[1.55] text-dim">
            {VIEW_ONLY_CONTROL_NOTE}
          </p>
        </div>
      )}

      <div
        className="flex items-end gap-6 border-b border-rule"
        role="tablist"
        aria-label="Approval views"
      >
        <button
          type="button"
          id="approvals-tab-pending"
          onClick={() => switchTab("pending")}
          onKeyDown={handleTabKeyDown}
          tabIndex={activeTab === "pending" ? 0 : -1}
          className={`relative inline-flex cursor-pointer items-center gap-2 pb-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lead/30 ${
            activeTab === "pending"
              ? "text-lead after:absolute after:inset-x-0 after:bottom-[-1px] after:h-0.5 after:bg-lead"
              : "text-dim hover:text-ink"
          }`}
          aria-controls="approvals-panel-pending"
          aria-selected={activeTab === "pending"}
          role="tab"
        >
          Awaiting review
          <span
            className={`rounded-full px-2 py-0.5 text-[11px] tabular-nums ${
              activeTab === "pending" ? "bg-lead-wash text-lead" : "bg-paper-sunk text-dim"
            }`}
          >
            {pending.length}
          </span>
        </button>

        <button
          type="button"
          id="approvals-tab-history"
          onClick={() => switchTab("history")}
          onKeyDown={handleTabKeyDown}
          tabIndex={activeTab === "history" ? 0 : -1}
          className={`relative inline-flex cursor-pointer items-center gap-2 pb-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lead/30 ${
            activeTab === "history"
              ? "text-lead after:absolute after:inset-x-0 after:bottom-[-1px] after:h-0.5 after:bg-lead"
              : "text-dim hover:text-ink"
          }`}
          aria-controls="approvals-panel-history"
          aria-selected={activeTab === "history"}
          role="tab"
        >
          Decision history
          <span
            className={`rounded-full px-2 py-0.5 text-[11px] tabular-nums ${
              activeTab === "history" ? "bg-lead-wash text-lead" : "bg-paper-sunk text-dim"
            }`}
          >
            {decided.length}
          </span>
        </button>
      </div>

      {feedback && (
        <div aria-live="polite">
          {feedback.type === "error" ? (
            <InlineAlert
              variant="page"
              className="rounded-panel border-stop/20 bg-stop-wash/60 text-stop"
              message={feedback.message}
            />
          ) : feedback.type === "undone" ? (
            <div
              role="status"
              className="flex flex-wrap items-center justify-between gap-3 rounded-inset border border-stop/25 bg-white px-4 py-3 text-sm font-medium text-stop shadow-xs"
            >
              <div className="flex items-center gap-2">
                <X className="size-4 shrink-0 text-stop" aria-hidden="true" />
                <span>{feedback.message}</span>
              </div>
              <button
                type="button"
                onClick={() => showFeedback(null)}
                aria-label="Dismiss notification"
                className="cursor-pointer text-stop/60 transition-colors hover:text-stop"
              >
                <X className="size-3.5" aria-hidden="true" />
              </button>
            </div>
          ) : (
            <div
              role="status"
              className="flex flex-wrap items-center justify-between gap-3 rounded-inset bg-go-wash px-4 py-3 text-sm font-medium text-go"
            >
              <div className="flex items-center gap-2">
                <Check className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                <span>{feedback.message}</span>
              </div>
              {feedback.canUndo && (
                <button
                  type="button"
                  onClick={handleUndo}
                  className="inline-flex cursor-pointer items-center gap-1.5 rounded-inset border border-stop/30 bg-stop px-2.5 py-1 text-xs font-semibold text-white shadow-xs transition-colors hover:border-stop hover:bg-stop/90 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stop/30"
                >
                  <Undo2 className="size-3.5 text-white" aria-hidden="true" />
                  Undo
                </button>
              )}
            </div>
          )}
        </div>
      )}

      <section
        id="approvals-panel-pending"
        role="tabpanel"
        aria-labelledby="approvals-tab-pending"
        hidden={activeTab !== "pending"}
      >
        {pending.length === 0 ? (
          <div className="rounded-panel border border-dashed border-rule bg-white px-6 py-12 text-center">
            <Check className="mx-auto size-6 text-go" aria-hidden="true" />
            <h2 className="mt-3 font-body text-[18px] font-semibold tracking-[-0.01em] text-ink">
              Nothing is waiting for review
            </h2>
            <p className="mt-1 text-[13px] leading-[1.55] text-dim">
              New client-record changes will appear here when a CAM sends one for approval.
            </p>
          </div>
        ) : (
          <ul className="space-y-4">
            {pending.map((row) => (
              <PendingSuggestionCard
                key={row.id}
                row={row}
                canDecide={canDecide}
                decisionInFlight={
                  busyDecision?.id === row.id
                    ? busyDecision.approve
                      ? "approve"
                      : "reject"
                    : null
                }
                source={sourceByOrganisation[row.organisation_id] ?? {}}
                onApprove={(customProposedValue) =>
                  void handleDecision(row, true, customProposedValue)
                }
                onReject={() => {
                  setRejectionError(null);
                  setRejectionTarget(row);
                }}
              />
            ))}
          </ul>
        )}
      </section>

      <section
        id="approvals-panel-history"
        role="tabpanel"
        aria-labelledby="approvals-tab-history"
        hidden={activeTab !== "history"}
      >
        {decided.length === 0 ? (
          <div className="rounded-panel border border-dashed border-rule bg-white px-6 py-12 text-center">
            <History className="mx-auto size-6 text-faint" aria-hidden="true" />
            <h2 className="mt-3 font-body text-[18px] font-semibold tracking-[-0.01em] text-ink">
              No decisions have been recorded
            </h2>
            <p className="mt-1 text-[13px] leading-[1.55] text-dim">
              Approved and rejected changes will stay here as a readable audit trail.
            </p>
          </div>
        ) : (
          <div className="relative space-y-4">
            {/* Sticky Search Bar Rail */}
            <div className="pointer-events-none absolute inset-x-0 -top-1.5 bottom-0 z-40">
              <div className="sticky top-3 flex justify-end">
                <div className="pointer-events-auto w-full sm:w-[380px] lg:w-[440px]">
                  <BrandSearchBar
                    tone="light"
                    chipsBelow={false}
                    filters={searchFilters}
                    clearRowOnOpen
                    placeholder="Search"
                    subjects={["client names", "fields", "values", "reviewers", "reasons"]}
                    categories={searchCategories}
                    params={{
                      [OUTCOME_FILTER_CATEGORY]: "outcome",
                      [FIELD_FILTER_CATEGORY]: "field",
                      [REVIEWER_FILTER_CATEGORY]: "reviewer",
                      [PROPOSER_FILTER_CATEGORY]: "proposer",
                    }}
                    onQueryChange={(query) => {
                      setSearchQuery(query);
                      setHistoryPage(1);
                    }}
                    onSubmitQuery={(query, filters) => {
                      setSearchQuery(query);
                      setSearchFilters(filters);
                      setHistoryPage(1);
                    }}
                  />
                </div>
              </div>
            </div>

            {/* 1. Header with title on left, reserving space for sticky search bar on sm/lg */}
            <div className="flex min-h-[64px] flex-col justify-center pt-[72px] sm:pt-0 sm:pr-[400px] lg:pr-[460px]">
              <div>
                <h2
                  id="decision-history-heading"
                  className="font-body text-[18px] font-semibold tracking-[-0.01em] text-ink"
                >
                  Recorded decisions
                </h2>
                <p className="mt-0.5 text-[13px] leading-[1.55] text-dim">
                  What was proposed, what happened, and who made the decision.
                </p>
              </div>
            </div>

            {/* 2. Showing count & filter pills on left & Expand/Collapse All toggle on right (below the search bar) */}
            <div className="relative z-20 flex flex-wrap items-center justify-between gap-3 pt-1">
              <div className="relative z-20 flex flex-wrap items-center gap-2 text-xs text-dim">
                <span>
                  Showing{" "}
                  {filteredDecisions.length > 0
                    ? `${(historyPage - 1) * historyPageSize + 1}–${Math.min(
                        historyPage * historyPageSize,
                        filteredDecisions.length,
                      )} of ${filteredDecisions.length}`
                    : "0"}{" "}
                  recorded {filteredDecisions.length === 1 ? "decision" : "decisions"}
                  {(searchQuery || searchFilters.length > 0) && (
                    <> (filtered from {decided.length})</>
                  )}
                </span>

                {/* Filter pills showing in the same row as Expand visible */}
                {searchFilters.map((filter) => {
                  const isApproved = filter.value === "approved";
                  const isRejected = filter.value === "rejected";
                  const isSuperseded = filter.value === "superseded";

                  const pillStyle = isApproved
                    ? "bg-go-wash text-go border-go/25"
                    : isRejected
                      ? "bg-stop-wash text-stop border-stop/25"
                      : isSuperseded
                        ? "bg-paper-sunk text-dim border-rule"
                        : "bg-paper text-ink border-rule";

                  return (
                    <span
                      key={`${filter.category}-${filter.value}`}
                      className={`relative z-30 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[12px] font-semibold shadow-2xs ${pillStyle}`}
                    >
                      <span>{filter.label}</span>
                      <button
                        type="button"
                        onClick={() => {
                          setSearchFilters((current) =>
                            current.filter(
                              (f) =>
                                !(
                                  f.category === filter.category &&
                                  f.value === filter.value
                                ),
                            ),
                          );
                          setHistoryPage(1);
                        }}
                        aria-label={`Remove ${filter.label} filter`}
                        className="flex size-3.5 cursor-pointer items-center justify-center rounded-full bg-black/5 hover:bg-black/15 transition-colors"
                      >
                        <X className="size-2.5" aria-hidden="true" />
                      </button>
                    </span>
                  );
                })}

                {(searchQuery || searchFilters.length > 0) && (
                  <button
                    type="button"
                    onClick={() => {
                      setSearchQuery("");
                      setSearchFilters([]);
                      setHistoryPage(1);
                    }}
                    className="cursor-pointer font-semibold text-lead hover:underline"
                  >
                    Clear search and filters
                  </button>
                )}
              </div>

              {filteredDecisions.length > 0 && (
                <button
                  type="button"
                  onClick={toggleAllVisible}
                  className="relative z-10 shrink-0 inline-flex cursor-pointer items-center gap-1.5 rounded-inset border border-rule bg-white px-3 py-1.5 font-body text-[12px] font-semibold text-ink shadow-2xs transition-colors hover:bg-paper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lead/30"
                >
                  <ChevronsUpDown className="size-3.5 text-dim" aria-hidden="true" />
                  {allVisibleExpanded ? "Collapse visible" : "Expand visible"}
                </button>
              )}
            </div>

            {/* 3. Decision List with Date Grouping (Tactics 1 & 4) */}
            {filteredDecisions.length === 0 ? (
              <div className="rounded-panel border border-dashed border-rule bg-white px-6 py-10 text-center">
                <p className="text-sm font-medium text-ink">No matching decisions found</p>
                <p className="mt-1 text-xs text-dim">
                  Try adjusting your search query or filter to find what you need.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery("");
                    setSearchFilters([]);
                    setHistoryPage(1);
                  }}
                  className="mt-3 inline-flex cursor-pointer text-xs font-semibold text-lead hover:underline"
                >
                  Clear search and filters
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                {groupedDecisions.map((group) => (
                  <div key={group.label} className="space-y-2">
                    <div className="px-1 text-[11.5px] font-bold uppercase tracking-wider text-dim">
                      {group.label}
                    </div>
                    <ul className="space-y-3">
                      {group.rows.map((row) => (
                        <DecidedSuggestionCard
                          key={row.id}
                          row={row}
                          canDecide={canDecide}
                          isExpanded={expandedIds.has(row.id)}
                          onToggle={() => toggleExpand(row.id)}
                        />
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}

            {/* 6. FeedPagination (Tactic 5) */}
            {filteredDecisions.length > 0 && (
              <div className="overflow-hidden rounded-panel border border-rule bg-white shadow-2xs">
                <FeedPagination
                  totalItems={filteredDecisions.length}
                  pageSize={historyPageSize}
                  currentPage={historyPage}
                  onPageChange={setHistoryPage}
                  onPageSizeChange={(size) => {
                    setHistoryPageSize(size);
                    setHistoryPage(1);
                  }}
                  pageSizeOptions={[10, 15, 25, 50]}
                />
              </div>
            )}
          </div>
        )}
      </section>

      <Dialog
        open={rejectionTarget !== null}
        onOpenChange={(open) => {
          const savingRejection =
            rejectionTarget !== null &&
            busyDecision?.id === rejectionTarget.id &&
            !busyDecision.approve;
          if (!open && !savingRejection) {
            setRejectionTarget(null);
            setRejectionError(null);
          }
        }}
      >
        <DialogContent className="rounded-panel border-rule bg-white sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-body text-[20px] font-semibold leading-[1.25] tracking-[-0.015em] text-ink">
              Reject this change?
            </DialogTitle>
            <DialogDescription className="leading-[1.6] text-dim">
              {rejectionTarget
                ? `${restrictedFieldLabel(rejectionTarget.field_name)} for ${rejectionTarget.organisations?.legal_name ?? "this client"} will not be applied.`
                : "This change will not be applied."}
            </DialogDescription>
          </DialogHeader>

          {rejectionTarget && (
            <div>
              <label
                htmlFor="approval-rejection-reason"
                className="block text-[13px] font-semibold text-ink"
              >
                Reason <span className="font-normal text-dim">(optional)</span>
              </label>
              <p className="mt-0.5 text-[12.5px] leading-[1.5] text-dim">
                Add context so the CAM knows why the change was not accepted.
              </p>
              <textarea
                id="approval-rejection-reason"
                rows={3}
                disabled={busyDecision?.id === rejectionTarget.id}
                value={reasons[rejectionTarget.id] ?? ""}
                onChange={(event) =>
                  setReasons((current) => ({
                    ...current,
                    [rejectionTarget.id]: event.target.value,
                  }))
                }
                placeholder="For example, the public register shows a different address."
                className="mt-2 w-full resize-y rounded-inset border border-rule bg-white px-3 py-2.5 text-sm leading-[1.55] text-ink outline-none transition-[border-color,box-shadow] placeholder:text-faint focus-visible:border-lead focus-visible:ring-2 focus-visible:ring-lead/20 disabled:opacity-60"
              />
              {rejectionError && (
                <p role="alert" className="mt-2 text-[13px] font-medium text-stop">
                  {rejectionError}
                </p>
              )}
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-2">
            <DialogClose asChild>
              <button
                type="button"
                disabled={
                  rejectionTarget !== null &&
                  busyDecision?.id === rejectionTarget.id &&
                  !busyDecision.approve
                }
                className="inline-flex h-9 cursor-pointer items-center justify-center rounded-inset px-3.5 text-[13px] font-semibold text-dim transition-colors hover:bg-paper hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lead/30 disabled:pointer-events-none disabled:opacity-50"
              >
                Cancel
              </button>
            </DialogClose>
            <button
              type="button"
              disabled={
                rejectionTarget === null ||
                (busyDecision?.id === rejectionTarget.id && !busyDecision.approve)
              }
              onClick={() => {
                if (rejectionTarget) void handleDecision(rejectionTarget, false);
              }}
              className="inline-flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-inset border border-stop bg-stop px-3.5 text-[13px] font-semibold text-white transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stop/25 disabled:pointer-events-none disabled:opacity-50"
            >
              {rejectionTarget &&
              busyDecision?.id === rejectionTarget.id &&
              !busyDecision.approve ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <X className="size-3.5" aria-hidden="true" />
              )}
              {rejectionTarget &&
              busyDecision?.id === rejectionTarget.id &&
              !busyDecision.approve
                ? "Rejecting change"
                : "Reject change"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
