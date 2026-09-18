"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { Building2, Check, ChevronDown, Loader2, X } from "lucide-react";
import { Pill } from "@/app/(app)/clients/[id]/section-card";
import { FiledCheckbox } from "@/components/ui/filed-checkbox";
import { OriginButton } from "@/components/ui/origin-button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { validateClientEmail } from "@/lib/client-email-validation";
import type { ManualEntryReviewRow } from "@/lib/manual-entry";
import { validateWebsiteFormat } from "@/lib/website-validation";
import {
  approveManualEntry,
  checkAvailableManualEntryDependencies,
  rejectManualEntry,
  type ManualEntryReviewState,
} from "./manual-entry-actions";

const initialReviewState: ManualEntryReviewState = { kind: "idle", message: "" };

const CHECK_STYLES = {
  passed: "border-go/25 bg-go-wash/50",
  warning: "border-hold/25 bg-hold-wash/60",
  blocked: "border-stop/25 bg-stop-wash/60",
} as const;

const CHECK_LABEL_TONE = {
  passed: "text-go",
  warning: "text-hold",
  blocked: "text-stop",
} as const;

function firstName(
  person: { full_name: string | null } | { full_name: string | null }[] | null,
): string | null {
  const row = Array.isArray(person) ? person[0] : person;
  return row?.full_name ?? null;
}

function submitterName(entry: ManualEntryReviewRow): string {
  return firstName(entry.submitter) ?? "Unknown CAM";
}

function reviewerName(entry: ManualEntryReviewRow): string | null {
  return firstName(entry.reviewed_by);
}

/**
 * The shared-inbox confirmation, when it still covers the entry's address. The
 * RPC binds a confirmation to one address, so a mismatch here means it is void.
 */
function roleConfirmation(entry: ManualEntryReviewRow): { by: string; at: string } | null {
  if (!entry.contact_email || !entry.contact_email_role_confirmed_for) return null;
  if (entry.contact_email.trim().toLowerCase() !== entry.contact_email_role_confirmed_for) return null;
  return {
    by: firstName(entry.role_confirmer) ?? "a deleted user",
    at: entry.contact_email_role_confirmed_at
      ? new Date(entry.contact_email_role_confirmed_at).toLocaleDateString("en-GB")
      : "",
  };
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function EntryFacts({ entry }: { entry: ManualEntryReviewRow }) {
  const emailStatus = validateClientEmail(entry.contact_email);
  const websiteStatus = validateWebsiteFormat(entry.website);
  const confirmation = roleConfirmation(entry);
  return (
    <div>
      <p className="text-sm leading-[1.65] text-ink">{entry.reason_for_manual_entry}</p>
      <p className="mt-2 text-sm leading-[1.65] text-dim">{entry.mission_statement}</p>
      <p className="mt-2 text-[12.5px] leading-[1.5] text-dim">
        {entry.organisation_type} · {entry.address_line_1}, {entry.city}, {entry.postcode},{" "}
        {entry.country_code}
      </p>
      {(entry.sector || entry.geographic_reach || entry.accounts_year_end) && (
        <p className="mt-2 text-sm leading-[1.65] text-dim">
          {[
            entry.sector,
            entry.geographic_reach && `${entry.geographic_reach} reach`,
            entry.latest_income !== null && `£${entry.latest_income.toLocaleString("en-GB")} income`,
            entry.staff_count !== null && `${entry.staff_count} staff`,
            entry.volunteer_count !== null && `${entry.volunteer_count} volunteers`,
            entry.accounts_year_end && `year to ${entry.accounts_year_end}`,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      )}
      {(entry.website || entry.contact_email || entry.registry_number) && (
        <p className="mt-2 text-[12.5px] leading-[1.5] text-dim">
          {[entry.website, entry.contact_email, entry.registry_name, entry.registry_number]
            .filter(Boolean)
            .join(" · ")}
          {/* The register's own second number, so the approver can see the
              record will carry two identifiers rather than one before they
              decide. */}
          {entry.company_number && ` · also a company (Companies House ${entry.company_number})`}
        </p>
      )}
      {confirmation && (
        <p
          className="mt-3 rounded-inset border border-hold/25 bg-hold-wash/60 px-3.5 py-2.5 text-[13px] leading-[1.55] text-dim"
          role="note"
        >
          <span className="font-semibold text-hold">
            Shared inbox confirmed by {confirmation.by}
          </span>
          {confirmation.at && ` on ${confirmation.at}`}. {entry.contact_email} looked like a
          personal address. Check it is the organisation&rsquo;s inbox, not a named
          person&rsquo;s, before approving.
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <Pill tone={emailStatus.status === "invalid" ? "stop" : emailStatus.status === "valid" ? "go" : "neutral"}>
          Email: {emailStatus.status}
        </Pill>
        <Pill
          tone={
            websiteStatus.status === "invalid" || websiteStatus.status === "unreachable"
              ? "stop"
              : websiteStatus.status === "valid" || websiteStatus.status === "reachable"
                ? "go"
                : "neutral"
          }
        >
          Website: {websiteStatus.status}
        </Pill>
      </div>
    </div>
  );
}

/**
 * One submitted organisation, read like a suggestion card: the name and who
 * sent it stay on the closed header, and the profile, the automated checks and
 * the decision controls sit underneath. The checks must run before approval —
 * the approve form only appears once they have, because the duplicate decision
 * it asks for comes from their result.
 */
export function PendingManualEntryCard({
  entry,
  canDecide,
  onDecided,
}: {
  entry: ManualEntryReviewRow;
  /** Same permission asked by all three writes. Viewers read the card only. */
  canDecide: boolean;
  onDecided: (result: {
    entryId: string;
    outcome: "approved" | "rejected";
    organisationId: string | null;
    notes: string;
    clientName: string;
  }) => void;
}) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [checks, checkAction, checking] = useActionState(
    checkAvailableManualEntryDependencies,
    initialReviewState,
  );
  const [approval, approvalAction, approving] = useActionState(
    approveManualEntry,
    initialReviewState,
  );
  const [rejection, rejectionAction, rejecting] = useActionState(
    rejectManualEntry,
    initialReviewState,
  );
  const [eligible, setEligible] = useState(false);
  const [duplicateDecision, setDuplicateDecision] = useState("link_existing");
  /** Uncontrolled notes fields are read here on submit, so success can carry them. */
  const approvalNotesRef = useRef("");
  const rejectionNotesRef = useRef("");
  const reportedRef = useRef(false);
  const headingId = `manual-entry-${entry.id}`;
  const detailsId = `${headingId}-details`;

  useEffect(() => {
    if (reportedRef.current) return;
    if (approval.kind === "success") {
      reportedRef.current = true;
      onDecided({
        entryId: entry.id,
        outcome: "approved",
        organisationId:
          duplicateDecision === "link_existing"
            ? (checks.approval?.candidateOrganisationId ?? null)
            : (approval.organisationId ?? null),
        notes: approvalNotesRef.current,
        clientName: entry.legal_name,
      });
    } else if (rejection.kind === "success") {
      reportedRef.current = true;
      onDecided({
        entryId: entry.id,
        outcome: "rejected",
        organisationId: null,
        notes: rejectionNotesRef.current,
        clientName: entry.legal_name,
      });
    }
  }, [approval, rejection, checks.approval, duplicateDecision, entry.id, entry.legal_name, onDecided]);

  return (
    <li>
      <article
        aria-labelledby={headingId}
        className="rounded-panel border border-rule bg-white px-5 py-5 sm:px-6"
      >
        <header>
          <div
            onClick={(event) => {
              if ((event.target as HTMLElement).closest("a, button, input, textarea, select, label")) {
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
                {entry.legal_name}
              </h2>
              <p className="mt-1 text-[13px] leading-[1.55] text-dim">
                New client proposed by {submitterName(entry)} on {formatDateTime(entry.created_at)}
              </p>
            </div>

            <div className="flex max-w-full flex-wrap items-center justify-end gap-x-2.5 gap-y-1.5">
              <Pill tone="hold">Pending review</Pill>
              <button
                type="button"
                aria-expanded={isExpanded}
                aria-controls={detailsId}
                aria-label={`${isExpanded ? "Hide" : "Show"} details for ${entry.legal_name}`}
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
            <div className="border-t border-rule-soft mt-4 pt-4 space-y-4">
              <div className="flex items-center gap-2 text-[13.5px] font-semibold text-ink">
                <Building2 className="size-[15px] text-faint" aria-hidden="true" />
                Proposed new client
              </div>

              <EntryFacts entry={entry} />

              {canDecide && (
                <div className="border-t border-rule-soft pt-4">
                  <h3 className="text-sm font-semibold text-ink">Approval checks</h3>
                  <p className="mt-0.5 text-[13px] leading-[1.55] text-dim">
                    Submitted organisation type:{" "}
                    <span className="font-medium text-ink">{entry.organisation_type}</span>
                  </p>
                  <form action={checkAction} className="mt-3 space-y-3">
                    <input name="id" type="hidden" value={entry.id} />
                    {(entry.organisation_type === "company" ||
                      entry.organisation_type === "other" ||
                      entry.organisation_type === "ngo") && (
                      <div className="flex items-start gap-2.5">
                        <FiledCheckbox
                          id={`eligible-${entry.id}`}
                          checked={eligible}
                          onCheckedChange={(value) => setEligible(value === true)}
                          className="mt-0.5"
                        />
                        <label
                          htmlFor={`eligible-${entry.id}`}
                          className="cursor-pointer text-[13px] leading-[1.55] text-ink"
                        >
                          I have confirmed that this organisation is a non-profit, social
                          enterprise, NGO or socially focused startup.
                        </label>
                        <input
                          name="adminConfirmedEligible"
                          type="hidden"
                          value={eligible ? "on" : ""}
                        />
                      </div>
                    )}
                    <button
                      className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-inset border border-rule bg-white px-3.5 text-[13px] font-semibold text-ink transition-colors hover:bg-paper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lead/30 disabled:pointer-events-none disabled:opacity-50"
                      disabled={checking}
                      type="submit"
                    >
                      {checking && <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />}
                      {checking ? "Running checks…" : "Run approval checks"}
                    </button>
                  </form>

                  {checks.message && (
                    <p
                      className={`mt-3 rounded-inset border px-3.5 py-2.5 text-[13px] leading-[1.55] ${
                        checks.kind === "error"
                          ? "border-stop/25 bg-stop-wash/60 text-stop"
                          : "border-lead/25 bg-lead-wash/60 text-lead"
                      }`}
                      role={checks.kind === "error" ? "alert" : "status"}
                    >
                      {checks.message}
                    </p>
                  )}
                  {checks.checks && (
                    <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                      {checks.checks.map((check) => (
                        <li
                          className={`rounded-inset border p-3 text-sm leading-[1.55] ${CHECK_STYLES[check.status]}`}
                          key={check.label}
                        >
                          <p className={`font-semibold ${CHECK_LABEL_TONE[check.status]}`}>
                            {check.label}: {check.status}
                          </p>
                          <p className="mt-1 text-dim">{check.message}</p>
                        </li>
                      ))}
                    </ul>
                  )}

                  {checks.approval && (
                    <form
                      action={approvalAction}
                      className="mt-4 space-y-3 rounded-inset border border-rule bg-paper px-4 py-3.5"
                    >
                      <input name="id" type="hidden" value={entry.id} />
                      <input
                        name="adminConfirmedEligible"
                        type="hidden"
                        value={String(checks.approval.adminConfirmedEligible)}
                      />
                      <input
                        name="candidateOrganisationId"
                        type="hidden"
                        value={checks.approval.candidateOrganisationId ?? ""}
                      />

                      {checks.approval.candidateOrganisationId ? (
                        <>
                          <p className="text-sm font-semibold text-hold">
                            Human duplicate decision required
                          </p>
                          <p className="text-[13px] leading-[1.55] text-dim">
                            The matcher found{" "}
                            <Link
                              className="font-semibold text-lead hover:underline"
                              href={`/clients/${checks.approval.candidateOrganisationId}`}
                              target="_blank"
                            >
                              {checks.approval.candidateOrganisationName ?? "an existing client"}
                            </Link>
                            {checks.approval.matchedOn === "registration_number"
                              ? " with the same registration number."
                              : " with the same normalised name."}
                          </p>
                          <label className="block text-[13px] font-semibold text-ink">
                            Decision
                            <input
                              name="duplicateDecision"
                              type="hidden"
                              value={duplicateDecision}
                            />
                            <Select value={duplicateDecision} onValueChange={setDuplicateDecision}>
                              <SelectTrigger className="mt-1 w-full">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="link_existing">
                                  Same organisation — link existing client
                                </SelectItem>
                                <SelectItem value="create_new">
                                  Different organisation — create separate client
                                </SelectItem>
                              </SelectContent>
                            </Select>
                          </label>
                          <label className="block text-[13px] font-semibold text-ink">
                            Decision notes
                            <textarea
                              className="mt-1 w-full resize-y rounded-inset border border-rule bg-white px-3 py-2 text-sm leading-[1.55] text-ink outline-none placeholder:text-faint focus-visible:border-lead focus-visible:ring-2 focus-visible:ring-lead/20"
                              minLength={3}
                              name="notes"
                              required
                              rows={3}
                              onChange={(event) => {
                                approvalNotesRef.current = event.target.value;
                              }}
                            />
                          </label>
                        </>
                      ) : (
                        <>
                          <input name="duplicateDecision" type="hidden" value="create_new" />
                          <label className="block text-[13px] font-semibold text-ink">
                            Approval notes <span className="font-normal text-dim">(optional)</span>
                            <textarea
                              className="mt-1 w-full resize-y rounded-inset border border-rule bg-white px-3 py-2 text-sm leading-[1.55] text-ink outline-none placeholder:text-faint focus-visible:border-lead focus-visible:ring-2 focus-visible:ring-lead/20"
                              name="notes"
                              rows={2}
                              onChange={(event) => {
                                approvalNotesRef.current = event.target.value;
                              }}
                            />
                          </label>
                        </>
                      )}

                      <OriginButton disabled={approving} loading={approving} size="md" type="submit">
                        {approving
                          ? "Approving…"
                          : checks.approval.candidateOrganisationId
                            ? "Save decision and approve"
                            : "Approve and create client"}
                      </OriginButton>
                    </form>
                  )}

                  {approval.message && (
                    <p
                      className={`mt-3 rounded-inset border px-3.5 py-2.5 text-[13px] leading-[1.55] ${
                        approval.kind === "success"
                          ? "border-go/25 bg-go-wash/60 text-go"
                          : "border-stop/25 bg-stop-wash/60 text-stop"
                      }`}
                      role={approval.kind === "error" ? "alert" : "status"}
                    >
                      {approval.message}
                    </p>
                  )}

                  <form
                    action={rejectionAction}
                    className="mt-4 flex flex-wrap gap-2 border-t border-rule-soft pt-4"
                  >
                    <input name="id" type="hidden" value={entry.id} />
                    <input
                      className="min-w-40 flex-1 rounded-inset border border-rule bg-white px-3 py-2 text-sm text-ink outline-none placeholder:text-faint focus-visible:border-lead focus-visible:ring-2 focus-visible:ring-lead/20"
                      minLength={3}
                      name="notes"
                      placeholder="Reason for rejection"
                      required
                      onChange={(event) => {
                        rejectionNotesRef.current = event.target.value;
                      }}
                    />
                    <button
                      className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-inset border border-stop bg-stop px-3.5 text-[13px] font-semibold text-white transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stop/25 disabled:pointer-events-none disabled:opacity-50"
                      disabled={rejecting}
                      type="submit"
                    >
                      {rejecting ? (
                        <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                      ) : (
                        <X className="size-3.5" aria-hidden="true" />
                      )}
                      {rejecting ? "Rejecting…" : "Reject"}
                    </button>
                  </form>
                  {rejection.message && (
                    <p
                      className={`mt-3 rounded-inset border px-3.5 py-2.5 text-[13px] leading-[1.55] ${
                        rejection.kind === "success"
                          ? "border-go/25 bg-go-wash/60 text-go"
                          : "border-stop/25 bg-stop-wash/60 text-stop"
                      }`}
                      role={rejection.kind === "error" ? "alert" : "status"}
                    >
                      {rejection.message}
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </article>
    </li>
  );
}

/**
 * A decided manual entry: what was proposed, what happened, and who decided.
 * Read-only for everyone — the decision already ran through its audited RPC.
 */
export function DecidedManualEntryCard({
  entry,
  isExpanded,
  onToggle,
}: {
  entry: ManualEntryReviewRow;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const approved = entry.review_status === "approved";
  const headingId = `decided-manual-entry-${entry.id}`;
  const detailsId = `${headingId}-details`;
  const reviewer = reviewerName(entry);

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
                  {entry.legal_name}
                </h3>
                <span className="inline-flex items-center rounded-inset bg-paper px-2 py-0.5 text-xs font-medium text-dim">
                  New client
                </span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] leading-[1.5] text-dim">
                <span>
                  Proposed by {submitterName(entry)} on {formatDateTime(entry.created_at)}
                </span>
                {entry.reviewed_at && (
                  <>
                    <span className="text-rule">•</span>
                    <span>
                      {approved ? "Approved" : "Rejected"} {formatDateTime(entry.reviewed_at)}
                      {reviewer && <> by {reviewer}</>}
                    </span>
                  </>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2.5">
              <Pill tone={approved ? "go" : "stop"}>{approved ? "Approved" : "Rejected"}</Pill>
              <button
                type="button"
                aria-expanded={isExpanded}
                aria-controls={detailsId}
                aria-label={`${isExpanded ? "Hide" : "Show"} details for ${entry.legal_name}`}
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
              <EntryFacts entry={entry} />

              {entry.review_notes?.trim() && (
                <div
                  className={`mt-3 rounded-inset border px-3.5 py-2.5 ${
                    approved ? "border-rule bg-paper" : "border-stop/20 bg-stop-wash/40"
                  }`}
                >
                  <p
                    className={`text-[12px] font-semibold ${approved ? "text-dim" : "text-stop"}`}
                  >
                    {approved ? "Decision notes" : "Rejection reason"}
                  </p>
                  <p className="mt-0.5 text-[13px] leading-[1.55] text-dim">
                    {entry.review_notes.trim()}
                  </p>
                </div>
              )}

              {approved && entry.converted_to_organisation_id && (
                <div className="mt-3">
                  <Link
                    href={`/clients/${entry.converted_to_organisation_id}`}
                    className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-lead transition-colors hover:text-lead-mid hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lead/30"
                  >
                    <Check className="size-3.5" aria-hidden="true" />
                    Open client record
                  </Link>
                </div>
              )}
            </div>
          </div>
        </div>
      </article>
    </li>
  );
}
