"use client";

import { useEffect, useMemo, useState, useTransition, type ReactNode } from "react";
import { Lock, Pencil, Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/browser";
import {
  applyEnrichmentChange,
  applyOrganisationChange,
  buildBasicInfo,
  NOT_PROVIDED,
  type BasicInfoState,
  type OrganisationDetailRow,
} from "@/lib/client-basic-info";
import {
  idleEditBatchState,
  isUnchanged,
  normaliseFieldValue,
  type EditBatchState,
  type EditSuggestionRow,
} from "@/lib/edit-suggestions";
import type { AppRole } from "@/lib/auth/permissions.ts";
import { SectionCard } from "./section-card";
import {
  EditDraftBar,
  InlineFieldInput,
  fieldErrorsFrom,
  succeededFields,
} from "./inline-edit";
import { suggestEditsAction } from "./actions";
import { adminDirectEditsAction } from "./admin-actions";

/**
 * Field order is reading order, not schema order.
 *
 * `column` is the organisations column the row edits in place — null for the
 * two rows that are not corrections at all (`organisation_type` and
 * `geographic_reach` are enum-typed and `add_restricted_edit_field` refuses
 * them outright; pipeline stage has its own audited control in the header).
 * `Type` used to name `organisation_type` here and offer an Add button for it,
 * which could never do anything: the field can never be in the restricted set,
 * so the button never rendered and the mapping was decoration.
 *
 * `legal_name` is back. It was left out because the header already sets it as
 * the page's h1 — true, but it is also the single most-corrected field on a
 * record, and with the edit dialog gone this row is the only way to correct it.
 * It reads as confirmation of the h1 rather than a repeat of it, because the
 * value beside it is the *registered* name, spelled as the register spells it.
 *
 * Postcode has its own row for the same reason. It was folded into the address
 * line for display, which is fine to read and impossible to edit — you cannot
 * type a correction into half a composed string.
 */
const FIELDS: {
  label: string;
  /** Live value, read from panel state so Realtime updates flow through. */
  read: (state: BasicInfoState, info: ReturnType<typeof buildBasicInfo>) => string | null;
  /** The organisations column (or `mission_statement`) this row edits. */
  column: string | null;
}[] = [
  { label: "Registered name", read: (state) => state.organisation.legal_name, column: "legal_name" },
  { label: "Mission", read: (state) => state.missionStatement, column: "mission_statement" },
  { label: "Type", read: (_state, info) => info.type, column: null },
  { label: "Pipeline stage", read: (_state, info) => info.status, column: null },
  { label: "Email", read: (state) => state.organisation.contact_email, column: "contact_email" },
  { label: "Website", read: (state) => state.organisation.website, column: "website" },
  { label: "Address", read: (state) => state.organisation.address_line_1, column: "address_line_1" },
  { label: "Town or city", read: (state) => state.organisation.city, column: "city" },
  { label: "Postcode", read: (state) => state.organisation.postcode, column: "postcode" },
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
  editableFields,
  actorId,
  actorRole,
  suggestions = [],
  action,
}: {
  organisation: OrganisationDetailRow;
  missionStatement: string | null;
  missionEnrichedAt: string | null;
  /**
   * Fields this viewer may write in place — the active RESTRICTED_EDIT_FIELDS
   * names. Empty for viewers, so they get no pencils.
   */
  editableFields?: string[];
  actorId?: string;
  actorRole?: AppRole;
  /** Every suggestion on this record, so a field another CAM is already
   *  correcting can say so instead of offering an edit the RPC will refuse. */
  suggestions?: EditSuggestionRow[];
  /** Optional control pinned to the heading row. */
  action?: ReactNode;
}) {
  const editable = new Set(editableFields ?? []);
  const isAdmin = actorRole === "admin";
  const isCam = actorRole === "cam";
  const [state, setState] = useState<BasicInfoState>({
    organisation,
    missionStatement,
    missionEnrichedAt,
  });

  // Rows opened for editing, and what has been typed into them. Two maps rather
  // than one: a row can be open with the value untouched, which is not a change
  // and must not count toward the submit bar.
  const [editing, setEditing] = useState<string[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<EditBatchState>(idleEditBatchState);
  const [pending, startTransition] = useTransition();

  const pendingByField = useMemo(() => {
    const map = new Map<string, EditSuggestionRow>();
    for (const row of suggestions) {
      if (row.status === "pending") map.set(row.field_name, row);
    }
    return map;
  }, [suggestions]);

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
  const fieldErrors = fieldErrorsFrom(result);

  /** Rows whose draft actually differs from what is on record. */
  const changes = FIELDS.flatMap(({ column, read }) => {
    if (!column) return [];
    const draft = drafts[column];
    if (draft === undefined) return [];
    const value = normaliseFieldValue(column, draft);
    if (!value) return [];
    if (isUnchanged(column, draft, read(state, info))) return [];
    return [{ fieldName: column, value }];
  });

  function openRow(column: string, current: string | null) {
    setEditing((rows) => (rows.includes(column) ? rows : [...rows, column]));
    setDrafts((current_) => ({ ...current_, [column]: current_[column] ?? (current ?? "") }));
  }

  function closeRow(column: string) {
    setEditing((rows) => rows.filter((row) => row !== column));
    setDrafts((current) =>
      Object.fromEntries(Object.entries(current).filter(([field]) => field !== column)),
    );
  }

  function discardAll() {
    setEditing([]);
    setDrafts({});
    setReason("");
    setResult(idleEditBatchState);
  }

  function submit() {
    if (changes.length === 0) return;
    startTransition(async () => {
      const next = isAdmin
        ? await adminDirectEditsAction({ organisationId: organisation.id, changes })
        : await suggestEditsAction({
            organisationId: organisation.id,
            reason: reason.trim() || null,
            changes,
          });
      setResult(next);

      // Only the fields that landed close. Anything that failed stays open with
      // its value and its own error, which is the whole point of reporting the
      // batch per field rather than as one verdict.
      const landed = new Set(succeededFields(next));
      if (landed.size > 0) {
        setEditing((rows) => rows.filter((row) => !landed.has(row)));
        setDrafts((current) =>
          Object.fromEntries(
            Object.entries(current).filter(([field]) => !landed.has(field)),
          ),
        );
        if (next.kind === "success") setReason("");
      }
    });
  }

  return (
    <SectionCard
      headingId="basic-info-heading"
      title="General Information"
      hint={
        isCam
          ? "Sourced from the registers above. A blank is a gap in the public record, not an error. Corrections go to an admin for review."
          : "Sourced from the registers above. A blank is a gap in the public record, not an error."
      }
      action={action}
    >
      {/* Label-beside-value rather than label-above-value: these are short
          field names against short values, and stacking them doubled the card's
          height for no gain. */}
      <dl className="mt-3.5 flex flex-col">
        {FIELDS.map(({ label, read, column }) => {
          const raw = read(state, info);
          const display = raw?.trim() ? raw.trim() : NOT_PROVIDED;
          const missing = display === NOT_PROVIDED;

          // Mission is not a column on organisations — it is the newest
          // enrichment row — so it can never be a suggestion. An admin writes it
          // directly; a CAM has nowhere to send it.
          const missionOnly = column === "mission_statement";
          const mayEdit =
            column !== null &&
            (isAdmin ? missionOnly || editable.has(column) : isCam && editable.has(column));

          const blocking = column ? pendingByField.get(column) : undefined;
          const blockedByOther =
            !isAdmin && blocking !== undefined && blocking.requested_by !== actorId;
          const isOpen = column !== null && editing.includes(column);

          return (
            <div
              key={label}
              className="grid gap-x-4 gap-y-0.5 border-t border-rule-soft py-2.5 first:border-t-0 first:pt-0 sm:grid-cols-[132px_minmax(0,1fr)]"
            >
              <dt className="text-[13px] text-dim">{label}</dt>
              <dd
                className={`flex min-w-0 flex-col gap-1.5 text-sm leading-[1.55] ${
                  missing ? "text-faint" : "text-ink"
                }`}
              >
                {isOpen && column ? (
                  <InlineFieldInput
                    fieldName={column}
                    label={label}
                    value={drafts[column] ?? ""}
                    currentValue={raw}
                    error={fieldErrors[column]}
                    onChange={(next) =>
                      setDrafts((current) => ({ ...current, [column]: next }))
                    }
                    onCancel={() => closeRow(column)}
                  />
                ) : (
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className="min-w-0 break-words">{display}</span>

                    {mayEdit && !blockedByOther && (
                      <button
                        type="button"
                        aria-label={`${missing ? "Add" : "Edit"} ${label.toLowerCase()}`}
                        onClick={() => openRow(column, raw)}
                        className="inline-flex shrink-0 items-center gap-1 rounded-inset border border-rule bg-white px-2 py-0.5 text-[12px] font-semibold text-lead transition-colors hover:border-lead focus-visible:ring-2 focus-visible:ring-lead-mid focus-visible:outline-none"
                      >
                        {missing ? (
                          <>
                            <Plus aria-hidden="true" className="size-3" />
                            Add
                          </>
                        ) : (
                          <>
                            <Pencil aria-hidden="true" className="size-3" />
                            Edit
                          </>
                        )}
                      </button>
                    )}

                    {blockedByOther && (
                      <span className="inline-flex shrink-0 items-center gap-1 text-[12px] text-faint">
                        <Lock aria-hidden="true" className="size-3" />
                        Correction pending
                      </span>
                    )}
                  </div>
                )}

                {/* An open proposal by this CAM: the row still shows the live
                    value, because that is what it is until an admin says
                    otherwise. */}
                {blocking && !blockedByOther && !isOpen && (
                  <p className="text-[12px] text-dim">
                    You proposed{" "}
                    <span className="font-semibold text-ink">{blocking.proposed_value}</span> —
                    awaiting review.
                  </p>
                )}

                {/* A field that failed while its row is shut: the message would
                    otherwise vanish with the input. */}
                {column && !isOpen && fieldErrors[column] && (
                  <p className="text-[12px] font-semibold text-stop" role="alert">
                    {fieldErrors[column]}
                  </p>
                )}
              </dd>
            </div>
          );
        })}
      </dl>

      {changes.length > 0 && (
        <EditDraftBar
          count={changes.length}
          isCam={!isAdmin}
          reason={reason}
          onReasonChange={setReason}
          onSubmit={submit}
          onDiscard={discardAll}
          pending={pending}
          state={result}
        />
      )}

      {/* Nothing pending, but the last submission said something worth keeping
          on screen — a success, or a failure that closed every row. */}
      {changes.length === 0 && result.kind !== "idle" && result.message && (
        <p
          aria-live="polite"
          className={`mt-3.5 text-[12.5px] font-semibold ${
            result.kind === "success"
              ? "text-go"
              : result.kind === "partial"
                ? "text-hold"
                : "text-stop"
          }`}
        >
          {result.message}
        </p>
      )}
    </SectionCard>
  );
}
