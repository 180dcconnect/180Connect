"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotionConfig } from "motion/react";
import { ChevronDown, Loader2 } from "lucide-react";
import { EASE } from "@/components/brand/motion";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  PagerRow,
  PageSizeSelect,
  PagingSummary,
  useListPager,
} from "@/components/ui/list-pager";
import {
  ThanosSnapEffect,
  type ThanosSnapEffectRef,
} from "@/components/ui/thanos-snap-effect";
import { Pill, SectionCard } from "@/app/(app)/clients/[id]/section-card";
import type { SuppressionRow } from "@/lib/suppressions";
import { NETWORK_ERROR_MESSAGE } from "@/lib/network-error";
import { reportError } from "@/lib/error-logging";
import { VIEW_ONLY_CONTROL_NOTE } from "@/lib/auth/view-only";
import {
  decideSuppressionAction,
  liftSuppressionAction,
  suppressClientAction,
} from "./actions";

type OrganisationOption = { id: string; legal_name: string };

/**
 * 5 / 10 / 15 / 20 rather than the shared 25/50: a blocked client is a person to
 * think about, not a row to skim, and the three lists on this page only grow — the
 * smallest useful page keeps the whole history reachable without a wall of them.
 *
 * Every list here pages from the top, beside its own heading, and keeps its own
 * window: reading page 2 of the queue must not move the history underneath it.
 */
const SUPPRESSION_PAGE_SIZES = [5, 10, 15, 20];

const STOP_BUTTON =
  "inline-flex min-h-9 cursor-pointer items-center justify-center gap-1.5 rounded-inset border border-stop bg-stop px-3 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-stop/90 focus-visible:ring-2 focus-visible:ring-stop/30 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50";

const PRIMARY_BUTTON =
  "inline-flex min-h-9 cursor-pointer items-center justify-center gap-1.5 rounded-inset border border-ink bg-ink px-3 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-lead focus-visible:ring-2 focus-visible:ring-lead/30 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50";

const SECONDARY_BUTTON =
  "inline-flex min-h-9 cursor-pointer items-center justify-center gap-1.5 rounded-inset border border-rule bg-white px-3 py-1.5 text-[13px] font-medium text-ink transition-colors hover:border-lead/40 hover:bg-paper focus-visible:ring-2 focus-visible:ring-lead/30 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50";

const QUIET_BUTTON =
  "inline-flex min-h-9 cursor-pointer items-center justify-center rounded-inset px-3 py-1.5 text-[13px] font-medium text-dim transition-colors hover:bg-paper hover:text-ink focus-visible:ring-2 focus-visible:ring-lead/30 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50";

const TEXTAREA =
  "mt-2 w-full resize-y rounded-inset border border-rule bg-white px-3 py-2 text-sm leading-[1.55] text-ink outline-none placeholder:text-faint focus-visible:border-lead focus-visible:ring-2 focus-visible:ring-lead/20 disabled:bg-paper disabled:opacity-70";

function personLabel(person: { full_name: string | null; email: string } | null): string {
  if (!person) return "A former team member";
  return person.full_name?.trim() || person.email;
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function ClientLink({ row }: { row: SuppressionRow }) {
  const name = row.organisations?.legal_name?.trim() || "Unnamed client";
  return (
    <Link
      href={`/clients/${row.organisation_id}`}
      className="rounded-sm text-lead underline decoration-lead/25 underline-offset-3 transition-colors hover:decoration-lead focus-visible:ring-2 focus-visible:ring-lead/30 focus-visible:outline-none"
    >
      {name}
    </Link>
  );
}

function SavedReason({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-inset bg-paper px-3.5 py-3">
      <p className="text-[12px] font-medium text-dim">{label}</p>
      <p className="mt-1 text-sm leading-[1.55] break-words text-ink">{children}</p>
    </div>
  );
}

export function SuppressionsPanel({
  initialSuppressions,
  organisations,
  canManage,
  suppressionsUnavailable,
  organisationsUnavailable,
}: {
  initialSuppressions: SuppressionRow[];
  organisations: OrganisationOption[];
  /** Same permission asked by all three writes. Viewers retain every reading. */
  canManage: boolean;
  suppressionsUnavailable: boolean;
  organisationsUnavailable: boolean;
}) {
  const [rows, setRows] = useState(initialSuppressions);
  const [organisationId, setOrganisationId] = useState("");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [liftReasons, setLiftReasons] = useState<Record<string, string>>({});
  const [activeLiftId, setActiveLiftId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; tone: "success" | "error" } | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  /**
   * The block form starts closed. Blocking a client is the exception on this
   * page — the state it leaves behind (who is blocked, who asked, what was
   * decided) is the page, and a form that is always open invites a stray click
   * to write to the most consequential column in the app.
   */
  const [isBlockFormOpen, setIsBlockFormOpen] = useState(false);
  /**
   * Whether the block form has finished opening. Clipping is only needed while
   * the height is moving — see the reveal below.
   */
  const [isBlockFormSettled, setIsBlockFormSettled] = useState(false);
  const reduceMotion = useReducedMotionConfig();
  /**
   * Cards the reader has opened. Folded is the default: what this page is for is
   * the register — who is blocked, since when and by whom — and that is the
   * summary line. One open reason per client is a list you have to scroll past to
   * find the client you came for. The reason, the approval note and the lift
   * button are one tap away, on the summary itself.
   */
  const [expandedActiveIds, setExpandedActiveIds] = useState<Set<string>>(new Set());
  /** The lift that has had its reason written but not its confirming click. */
  const [confirmingLiftId, setConfirmingLiftId] = useState<string | null>(null);
  /** One dissolve per active card, so a lift plays out on the row it removes. */
  const liftSnapRefs = useRef(new Map<string, ThanosSnapEffectRef | null>());
  /** The button that opens the block form, so the reader gets their focus back. */
  const openBlockFormRef = useRef<HTMLButtonElement | null>(null);

  const pending = rows.filter((row) => row.status === "pending");
  const active = rows.filter((row) => row.status === "active");
  const history = rows.filter((row) => row.status === "rejected" || row.status === "lifted");
  const openOrganisationIds = new Set(
    rows
      .filter((row) => row.status === "pending" || row.status === "active")
      .map((row) => row.organisation_id),
  );
  const availableOrganisations = organisations.filter(
    (organisation) => !openOrganisationIds.has(organisation.id),
  );
  const clientGroups = [
    {
      label: "Clients available to suppress",
      options: availableOrganisations.map((organisation) => ({
        value: organisation.id,
        label: organisation.legal_name,
      })),
    },
  ];
  const isBusy = busyKey !== null;
  const dataUnavailable = suppressionsUnavailable || organisationsUnavailable;

  // Every list on this page pages from the top, each with its own window.
  const requestsPager = useListPager(pending, 10, SUPPRESSION_PAGE_SIZES);
  const activePager = useListPager(active, 10, SUPPRESSION_PAGE_SIZES);
  const historyPager = useListPager(history, 10, SUPPRESSION_PAGE_SIZES);

  /**
   * Close the block form and drop what was typed. Cancelling is a decision not to
   * block anyone, so the client picker must not still hold last time's client when
   * the form is next opened.
   */
  function closeBlockForm() {
    setIsBlockFormOpen(false);
    setIsBlockFormSettled(false);
    setOrganisationId("");
    setReason("");
  }

  /** Fold or unfold one active card. */
  function toggleActiveCard(suppressionId: string) {
    setExpandedActiveIds((current) => {
      const next = new Set(current);
      if (next.has(suppressionId)) next.delete(suppressionId);
      else next.add(suppressionId);
      return next;
    });
  }

  async function submitCreate(event: React.FormEvent) {
    event.preventDefault();
    setBusyKey("create");
    setNotice(null);
    try {
      const result = await suppressClientAction({ organisationId, reason });
      if (!result.ok) {
        setNotice({ text: result.error, tone: "error" });
        return;
      }
      if (!result.suppressions) {
        setNotice({
          text: "The client was suppressed, but the page could not refresh its list. Refresh the page to see the latest status.",
          tone: "error",
        });
        return;
      }
      setRows(result.suppressions);
      // The form is on its way out and the reader's focus is inside it, so it goes
      // back to the button that opened it rather than falling to the page body.
      closeBlockForm();
      openBlockFormRef.current?.focus();
      setNotice({
        text: "Client suppressed. They are hidden from working lists and outreach is blocked.",
        tone: "success",
      });
    } catch (error) {
      void reportError(error, { operation: "admin.suppressions.create_client" });
      setNotice({ text: NETWORK_ERROR_MESSAGE, tone: "error" });
    } finally {
      setBusyKey(null);
    }
  }

  async function decide(suppressionId: string, approve: boolean) {
    setBusyKey(`decide:${suppressionId}`);
    setNotice(null);
    try {
      const result = await decideSuppressionAction({
        suppressionId,
        approve,
        note: notes[suppressionId] ?? "",
      });
      if (!result.ok) {
        setNotice({ text: result.error, tone: "error" });
        return;
      }
      if (!result.suppressions) {
        setNotice({
          text: "The decision was saved, but the page could not refresh its list. Refresh the page to see the latest status.",
          tone: "error",
        });
        return;
      }
      setRows(result.suppressions);
      setNotes((current) => {
        const next = { ...current };
        delete next[suppressionId];
        return next;
      });
      setNotice({
        text: approve
          ? "Request approved. The client is hidden and outreach is blocked."
          : "Request declined. The client remains active and outreach is unchanged.",
        tone: "success",
      });
    } catch (error) {
      void reportError(error, { operation: "admin.suppressions.decide_client" });
      setNotice({ text: NETWORK_ERROR_MESSAGE, tone: "error" });
    } finally {
      setBusyKey(null);
    }
  }

  async function lift(suppressionId: string) {
    setBusyKey(`lift:${suppressionId}`);
    setNotice(null);
    try {
      const result = await liftSuppressionAction({
        suppressionId,
        reason: liftReasons[suppressionId] ?? "",
      });
      if (!result.ok) {
        setNotice({ text: result.error, tone: "error" });
        return;
      }
      if (!result.suppressions) {
        setNotice({
          text: "The suppression was lifted, but the page could not refresh its list. Refresh the page to see the latest status.",
          tone: "error",
        });
        return;
      }
      // The card dissolves on its way out, then the list updates. The row is
      // held until the dissolve finishes: refreshing the list first would
      // unmount the card on the frame the snap starts, and nothing would be seen.
      try {
        await liftSnapRefs.current.get(suppressionId)?.snap();
      } catch {
        // The lift is already saved; a missed animation must not read as a
        // failed decision.
      }
      liftSnapRefs.current.delete(suppressionId);
      setRows(result.suppressions);
      setActiveLiftId(null);
      setConfirmingLiftId(null);
      setLiftReasons((current) => {
        const next = { ...current };
        delete next[suppressionId];
        return next;
      });
      setNotice({
        text: "Suppression lifted. The client is visible in working lists and outreach is available again.",
        tone: "success",
      });
    } catch (error) {
      void reportError(error, { operation: "admin.suppressions.lift_client" });
      setNotice({ text: NETWORK_ERROR_MESSAGE, tone: "error" });
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-dim">
          <span
            aria-hidden="true"
            className={`size-1.5 shrink-0 rounded-full ${active.length > 0 ? "bg-stop" : pending.length > 0 ? "bg-hold" : "bg-go"}`}
          />
          <span>
            <span className="font-semibold text-ink">
              {suppressionsUnavailable
                ? "Suppression status could not be loaded"
                : active.length === 0
                ? "No clients are currently suppressed"
                : `${active.length} ${active.length === 1 ? "client" : "clients"} blocked from outreach`}
            </span>
            {!suppressionsUnavailable && pending.length > 0 && (
              <>
                {" · "}
                {pending.length} {pending.length === 1 ? "request" : "requests"} waiting
              </>
            )}
          </span>
        </p>
        {!canManage && <p className="mt-2 text-sm text-dim">{VIEW_ONLY_CONTROL_NOTE}</p>}
      </div>

      {notice && (
        <p
          aria-live="polite"
          role={notice.tone === "error" ? "alert" : "status"}
          className={`rounded-panel border px-4 py-3 text-[13px] font-semibold ${
            notice.tone === "error"
              ? "border-stop/30 bg-stop-wash text-stop"
              : "border-go/30 bg-go-wash text-go"
          }`}
        >
          {notice.text}
        </p>
      )}

      <SectionCard
        headingId="suppress-client-heading"
        title="Block a client now"
        hint="The client disappears from standard working lists and nobody, including admins, can send outreach. You can lift the suppression from this page later."
        /*
         * The control that opens the form sits in the heading row, where the
         * card's other properties are, and turns into the way out of it. The
         * action is not available to a viewer, who has no form and nothing to
         * open, so the pill stands on its own for them.
         */
        action={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Pill tone="stop">Takes effect immediately</Pill>
            {canManage && (
              <button
                ref={openBlockFormRef}
                aria-controls={isBlockFormOpen ? "block-client-form" : undefined}
                aria-expanded={isBlockFormOpen}
                /* One width for both labels: the pill beside it must not move when
                   this button becomes Cancel. */
                className={`${isBlockFormOpen ? SECONDARY_BUTTON : STOP_BUTTON} min-w-[9.5rem]`}
                disabled={isBusy || (!isBlockFormOpen && dataUnavailable)}
                onClick={() => {
                  setNotice(null);
                  if (isBlockFormOpen) closeBlockForm();
                  else setIsBlockFormOpen(true);
                }}
                type="button"
              >
                {isBlockFormOpen ? "Cancel" : "Suppress a client"}
              </button>
            )}
          </div>
        }
      >
        {/*
         * The reveal is the client form's disclosure one (see
         * `clients/new/disclosure-section.tsx`), not the list-row fold: height and
         * opacity together, away from `card-collapse-grid`, and clipping only while
         * the height is moving.
         *
         * That last part is the whole reason it is not the fold class. "Nobody
         * types a client name" is not a promise this screen can make, so the form
         * holds a client dropdown — and a dropdown inside a clipped card is a list
         * of clients cut off at the card's edge, which is what the fold's permanent
         * `overflow: hidden` did to it. The clip comes off the moment the card has
         * settled, then back on for the collapse.
         */}
        <AnimatePresence initial={false}>
          {canManage && isBlockFormOpen && (
            <motion.div
              key="block-client-form"
              animate={{ height: "auto", opacity: 1 }}
              className={
                isBlockFormSettled ? "overflow-visible" : "overflow-hidden"
              }
              exit={{ height: 0, opacity: 0 }}
              id="block-client-form"
              initial={{ height: 0, opacity: 0 }}
              onAnimationComplete={() => {
                // Fires for the collapse too, where the form is on its way out and
                // neither the clip nor the focus is ours to change.
                if (!isBlockFormOpen) return;
                setIsBlockFormSettled(true);
                // Focus lands after the card has finished growing, so the reader
                // arrives in the field rather than half way down a moving one.
                document.getElementById("organisation")?.focus();
              }}
              onAnimationStart={() => setIsBlockFormSettled(false)}
              transition={reduceMotion ? { duration: 0 } : { duration: 0.35, ease: EASE }}
            >
              <form className="mt-4 border-t border-rule-soft pt-4" onSubmit={submitCreate}>
                <div className="grid gap-4 lg:grid-cols-2">
                  <div>
                    <label className="text-[13px] font-medium text-ink" htmlFor="organisation">
                      Client
                    </label>
                    <p className="mt-0.5 text-[12px] leading-[1.5] text-dim">
                      Clients with an open request or active suppression are left out.
                    </p>
                    <SearchableSelect
                      id="organisation"
                      value={organisationId}
                      onChange={setOrganisationId}
                      groups={clientGroups}
                      placeholder="Choose a client"
                      searchPlaceholder="Search clients"
                      emptyMessage="No available client matches that search."
                      ariaLabel="Client to suppress"
                      disabled={isBusy || dataUnavailable || availableOrganisations.length === 0}
                      className="mt-2"
                    />
                  </div>
                  <div>
                    <label className="text-[13px] font-medium text-ink" htmlFor="reason">
                      Why outreach must stop
                    </label>
                    <p className="mt-0.5 text-[12px] leading-[1.5] text-dim">
                      Required and kept with the client&apos;s suppression history.
                    </p>
                    <textarea
                      className={`${TEXTAREA} min-h-24`}
                      disabled={isBusy}
                      id="reason"
                      maxLength={2_000}
                      onChange={(event) => setReason(event.target.value)}
                      placeholder="For example: asked not to be contacted, legal request, or reputational concern"
                      rows={3}
                      value={reason}
                    />
                  </div>
                </div>
                {organisationsUnavailable ? (
                  <p className="mt-3 rounded-inset bg-stop-wash px-3 py-2.5 text-[13px] leading-[1.55] text-stop">
                    The client list could not be loaded. Refresh the page before suppressing a client.
                  </p>
                ) : suppressionsUnavailable ? (
                  <p className="mt-3 rounded-inset bg-stop-wash px-3 py-2.5 text-[13px] leading-[1.55] text-stop">
                    The current suppression list could not be checked. Refresh before suppressing another client.
                  </p>
                ) : availableOrganisations.length === 0 && (
                  <p className="mt-3 rounded-inset bg-paper px-3 py-2.5 text-[13px] leading-[1.55] text-dim">
                    No clients are available to suppress. Every client already has an open request or active suppression.
                  </p>
                )}
                <div className="mt-4 flex justify-end">
                  <button
                    className={STOP_BUTTON}
                    disabled={isBusy || dataUnavailable || !organisationId || reason.trim() === ""}
                    type="submit"
                  >
                    {busyKey === "create" && <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />}
                    Suppress client now
                  </button>
                </div>
              </form>
            </motion.div>
          )}
        </AnimatePresence>
      </SectionCard>

      <section aria-labelledby="suppression-requests-heading">
        <div className="mb-4">
          <h2
            id="suppression-requests-heading"
            className="font-body text-[19px] leading-[1.3] font-semibold tracking-[-0.01em] text-ink"
          >
            Requests waiting for a decision
          </h2>
          <p className="mt-1.5 text-[13px] leading-[1.55] text-dim">
            A CAM has asked for outreach to stop. Nothing changes until an admin approves the request.
          </p>
        </div>

        {suppressionsUnavailable ? (
          <SectionCard
            headingId="suppression-requests-unavailable-heading"
            title="Requests could not be loaded"
            hint="Refresh the page to check for CAM requests waiting for a decision."
            action={<Pill tone="stop">Unavailable</Pill>}
          />
        ) : pending.length === 0 ? (
          <SectionCard
            headingId="no-suppression-requests-heading"
            title="No requests are waiting"
            hint="New CAM requests will appear here with their reason before anything is blocked."
            action={<Pill tone="go">Up to date</Pill>}
          />
        ) : (
          <>
            {/* The request queue has no card of its own to hang a control on, so
                the count and the page size share the row above the first card. */}
            {requestsPager.showPager && (
              <PagerRow
                className="mb-4"
                onPageChange={requestsPager.setPage}
                onPageSizeChange={requestsPager.setPageSize}
                pageSize={requestsPager.pageSize}
                pageSizeOptions={SUPPRESSION_PAGE_SIZES}
                summary={requestsPager}
              />
            )}
            <ul className="space-y-4">
              {requestsPager.items.map((row) => {
                const noteId = `decision-note-${row.id}`;
                const rowBusy = busyKey === `decide:${row.id}`;
                return (
                  <li key={row.id}>
                    <SectionCard
                      headingId={`suppression-request-${row.id}`}
                      title={row.organisations?.legal_name?.trim() || "Unnamed client"}
                      hint={
                        <>
                          Requested by {personLabel(row.requested_by_user)} · {formatDate(row.created_at)}
                        </>
                      }
                      action={<Pill tone="hold">Awaiting decision</Pill>}
                    >
                      <div className="mt-4">
                        <SavedReason label="Why they want outreach blocked">{row.reason}</SavedReason>
                      </div>
                      <p className="mt-2 text-[12px] text-dim">
                        <ClientLink row={row} />
                      </p>

                      {canManage && (
                        <div className="mt-4 border-t border-rule-soft pt-4">
                          <label className="text-[13px] font-medium text-ink" htmlFor={noteId}>
                            Decision note <span className="font-normal text-faint">(optional)</span>
                          </label>
                          <p className="mt-0.5 text-[12px] leading-[1.5] text-dim">
                            Kept with the approval or decline in the history below.
                          </p>
                          <textarea
                            className={`${TEXTAREA} min-h-20`}
                            disabled={isBusy}
                            id={noteId}
                            maxLength={2_000}
                            onChange={(event) =>
                              setNotes((current) => ({ ...current, [row.id]: event.target.value }))
                            }
                            placeholder="Add context for the requester"
                            rows={2}
                            value={notes[row.id] ?? ""}
                          />
                          <div className="mt-3 grid gap-2 sm:grid-cols-2">
                            <button
                              className={STOP_BUTTON}
                              disabled={isBusy}
                              onClick={() => decide(row.id, true)}
                              type="button"
                            >
                              {rowBusy && <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />}
                              Approve and suppress client
                            </button>
                            <button
                              className={SECONDARY_BUTTON}
                              disabled={isBusy}
                              onClick={() => decide(row.id, false)}
                              type="button"
                            >
                              {rowBusy && <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />}
                              Leave client active
                            </button>
                          </div>
                        </div>
                      )}
                    </SectionCard>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </section>

      <SectionCard
        headingId="active-suppressions-heading"
        title="Active suppressions"
        hint="These clients are hidden from standard working lists and blocked from every outreach route. Lifting a suppression restores both."
        action={
          <div className="flex flex-wrap items-center justify-end gap-2">
            {active.length > 0 ? (
              <Pill tone="stop">{active.length} blocked</Pill>
            ) : (
              <Pill tone="go">None active</Pill>
            )}
            {activePager.showPager && (
              <PageSizeSelect
                pageSize={activePager.pageSize}
                onChange={activePager.setPageSize}
                pageSizeOptions={SUPPRESSION_PAGE_SIZES}
              />
            )}
          </div>
        }
      >
        {suppressionsUnavailable ? (
          <p className="mt-4 border-t border-rule-soft pt-4 text-[13px] leading-[1.55] text-stop">
            The active suppression list could not be loaded. Refresh the page before making a decision about a client.
          </p>
        ) : active.length === 0 ? (
          <p className="mt-4 border-t border-rule-soft pt-4 text-[13px] leading-[1.55] text-dim">
            No clients are currently hidden or blocked from outreach.
          </p>
        ) : (
          <>
            <div className="mt-4 space-y-3">
              {/* The count sits above the rows: this list only grows, and the
                  reader has to be able to see how much of it they are looking
                  at. The page size is on the card's heading row, beside the pill
                  — it is a property of the card, not of a row. */}
              {activePager.showPager && (
                <PagingSummary summary={activePager} onPageChange={activePager.setPage} />
              )}
              <ul className="divide-y divide-rule-soft border-t border-rule-soft">
                {activePager.items.map((row) => {
                  const liftReasonId = `lift-reason-${row.id}`;
                  const detailsId = `active-suppression-${row.id}-details`;
                  const rowBusy = busyKey === `lift:${row.id}`;
                  const isCollapsed = !expandedActiveIds.has(row.id);
                  const isConfirmingLift = confirmingLiftId === row.id;
                  const clientName =
                    row.organisations?.legal_name?.trim() || "Unnamed client";
                  return (
                    <li key={row.id} className="py-4 first:pt-4 last:pb-0">
                      {/* The dissolve plays on the card, not on the button that
                          triggered it: what leaves this list is the whole
                          suppression, so that is what should come apart. The
                          list is only refreshed once the animation resolves. */}
                      <ThanosSnapEffect
                        className="block"
                        triggerOnClick={false}
                        ref={(instance) => {
                          liftSnapRefs.current.set(row.id, instance);
                        }}
                      >
                        {/* Tap anywhere on the summary to fold the card — same
                            handle as the incomplete-records queue. Clicks that
                            belong to a link, a control or a text selection are
                            left alone so nothing is swallowed by the fold. */}
                        <div
                          className="flex cursor-pointer flex-wrap items-start justify-between gap-x-5 gap-y-2"
                          onClick={(event) => {
                            if (
                              (event.target as HTMLElement).closest(
                                "a, button, input, textarea, select, label",
                              )
                            ) {
                              return;
                            }
                            const selection = window.getSelection();
                            if (selection && selection.toString().trim().length > 0) return;
                            toggleActiveCard(row.id);
                          }}
                        >
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-semibold text-ink">
                              <ClientLink row={row} />
                            </p>
                            <p className="mt-1 text-[12px] leading-[1.5] text-dim">
                              {row.requested_by === row.decided_by
                                ? `Suppressed by ${personLabel(row.decided_by_user)} on ${formatDate(row.decided_at ?? row.created_at)}`
                                : `Requested by ${personLabel(row.requested_by_user)} · Approved by ${personLabel(row.decided_by_user)} on ${formatDate(row.decided_at ?? row.created_at)}`}
                            </p>
                          </div>
                          <div className="flex shrink-0 items-center gap-2.5">
                            <Pill tone="stop">Outreach blocked</Pill>
                            <button
                              type="button"
                              aria-expanded={!isCollapsed}
                              aria-controls={detailsId}
                              aria-label={`${isCollapsed ? "Show" : "Hide"} details for ${clientName}`}
                              onClick={() => toggleActiveCard(row.id)}
                              className="inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-inset text-dim transition-colors hover:bg-paper hover:text-ink focus-visible:ring-2 focus-visible:ring-lead/30 focus-visible:outline-none"
                            >
                              <ChevronDown
                                aria-hidden="true"
                                className={`size-4 transition-transform duration-200 ${isCollapsed ? "" : "rotate-180"}`}
                              />
                            </button>
                          </div>
                        </div>

                        <div
                          className="card-collapse-grid"
                          data-expanded={!isCollapsed}
                          id={detailsId}
                          aria-hidden={isCollapsed}
                          inert={isCollapsed}
                        >
                          <div>
                            <div className="mt-3">
                              <SavedReason label="Reason">{row.reason}</SavedReason>
                            </div>
                            {row.decision_note?.trim() && (
                              <p className="mt-2 text-[12px] leading-[1.5] text-dim">
                                Approval note: <span className="text-ink">{row.decision_note.trim()}</span>
                              </p>
                            )}

                            {canManage && activeLiftId !== row.id && (
                              <div className="mt-3">
                                <button
                                  className={SECONDARY_BUTTON}
                                  disabled={isBusy}
                                  onClick={() => {
                                    setActiveLiftId(row.id);
                                    setConfirmingLiftId(null);
                                    setNotice(null);
                                  }}
                                  type="button"
                                >
                                  Lift suppression
                                </button>
                              </div>
                            )}

                            {canManage && activeLiftId === row.id && (
                              <div className="mt-4 rounded-inset bg-paper px-4 py-3.5">
                                <label className="text-[13px] font-medium text-ink" htmlFor={liftReasonId}>
                                  Why this client can return
                                </label>
                                <p className="mt-0.5 text-[12px] leading-[1.5] text-dim">
                                  Required and kept on file. Lifting restores the client to working lists and unblocks outreach.
                                </p>
                                <textarea
                                  className={`${TEXTAREA} min-h-20`}
                                  disabled={isBusy}
                                  id={liftReasonId}
                                  maxLength={2_000}
                                  onChange={(event) =>
                                    setLiftReasons((current) => ({ ...current, [row.id]: event.target.value }))
                                  }
                                  placeholder="For example: suppressed in error, or the client has asked to re-engage"
                                  rows={2}
                                  value={liftReasons[row.id] ?? ""}
                                />

                                {/* Lifting is the one action on this page that
                                    undoes a decision someone else made, so the
                                    reason is written first and then confirmed —
                                    the second click is the one that saves. */}
                                {isConfirmingLift ? (
                                  <div className="mt-3">
                                    <p className="text-[12px] leading-[1.5] text-dim">
                                      Lift the suppression on {clientName}? They return to working lists and outreach
                                      opens again immediately. The reason above is saved with the decision.
                                    </p>
                                    <div className="mt-2 flex flex-wrap gap-2">
                                      <button
                                        className={PRIMARY_BUTTON}
                                        disabled={isBusy}
                                        onClick={() => lift(row.id)}
                                        type="button"
                                      >
                                        {rowBusy && <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />}
                                        Yes, lift the suppression
                                      </button>
                                      <button
                                        className={QUIET_BUTTON}
                                        disabled={isBusy}
                                        onClick={() => setConfirmingLiftId(null)}
                                        type="button"
                                      >
                                        Keep {clientName} blocked
                                      </button>
                                    </div>
                                  </div>
                                ) : (
                                  <div className="mt-3 flex flex-wrap gap-2">
                                    <button
                                      className={PRIMARY_BUTTON}
                                      disabled={isBusy || !(liftReasons[row.id] ?? "").trim()}
                                      onClick={() => setConfirmingLiftId(row.id)}
                                      type="button"
                                    >
                                      Restore client and outreach
                                    </button>
                                    <button
                                      className={QUIET_BUTTON}
                                      disabled={isBusy}
                                      onClick={() => {
                                        setActiveLiftId(null);
                                        setConfirmingLiftId(null);
                                        setLiftReasons((current) => {
                                          const next = { ...current };
                                          delete next[row.id];
                                          return next;
                                        });
                                      }}
                                      type="button"
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      </ThanosSnapEffect>
                    </li>
                  );
                })}
              </ul>
            </div>
          </>
        )}
      </SectionCard>

      <SectionCard
        headingId="suppression-history-heading"
        title="Suppression history"
        hint="Completed requests stay here so the team can see why outreach was left active or later restored."
        action={
          <div className="flex flex-wrap items-center justify-end gap-2">
            {history.length > 0 && <Pill dot={false}>{history.length.toLocaleString()}</Pill>}
            {historyPager.showPager && (
              <PageSizeSelect
                pageSize={historyPager.pageSize}
                onChange={historyPager.setPageSize}
                pageSizeOptions={SUPPRESSION_PAGE_SIZES}
              />
            )}
          </div>
        }
      >
        {suppressionsUnavailable ? (
          <p className="mt-4 border-t border-rule-soft pt-4 text-[13px] leading-[1.55] text-stop">
            Suppression history could not be loaded. Refresh the page to see completed decisions and restorations.
          </p>
        ) : history.length === 0 ? (
          <p className="mt-4 border-t border-rule-soft pt-4 text-[13px] leading-[1.55] text-dim">
            No suppression requests have been declined or lifted yet.
          </p>
        ) : (
          <>
            <div className="mt-4 space-y-3">
              {historyPager.showPager && (
                <PagingSummary summary={historyPager} onPageChange={historyPager.setPage} />
              )}
              <ul className="divide-y divide-rule-soft border-t border-rule-soft">
                {historyPager.items.map((row) => (
                  <li key={row.id} className="py-4 first:pt-4 last:pb-0">
                    <div className="flex flex-wrap items-start justify-between gap-x-5 gap-y-2">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-ink">
                          <ClientLink row={row} />
                        </p>
                        <p className="mt-1 text-[12px] leading-[1.5] text-dim">
                          Requested by {personLabel(row.requested_by_user)} · {formatDate(row.created_at)}
                        </p>
                      </div>
                      <Pill tone={row.status === "lifted" ? "go" : "neutral"}>
                        {row.status === "lifted" ? "Suppression lifted" : "Request declined"}
                      </Pill>
                    </div>
                    <div className="mt-3 grid gap-2 md:grid-cols-2">
                      <SavedReason label="Original reason">{row.reason}</SavedReason>
                      <SavedReason label={row.status === "lifted" ? "Why it was lifted" : "Decision note"}>
                        {row.decision_note?.trim() || "No note was added."}
                      </SavedReason>
                    </div>
                    <p className="mt-2 text-[12px] leading-[1.5] text-dim">
                      {row.status === "lifted" ? "Lifted" : "Decided"} by{" "}
                      <span className="font-medium text-ink">{personLabel(row.decided_by_user)}</span>
                      {row.decided_at ? ` on ${formatDate(row.decided_at)}` : ""}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}
      </SectionCard>
    </div>
  );
}
