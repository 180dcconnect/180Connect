"use client";

import {
  useEffect,
  useMemo,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { ExternalLink, Lock, Pencil, PencilLine, Plus } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { OriginButton } from "@/components/ui/origin-button";
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
import {
  GEOGRAPHIC_REACH_OPTIONS,
  ORGANISATION_TYPES,
  formatCountryName,
  formatGeographicReach,
  formatOrganisationType,
} from "@/lib/organisation-format";
import { SectionCard } from "./section-card";
import {
  EditDraftBar,
  InlineCityInput,
  InlineEnumInput,
  InlineFieldInput,
  fieldErrorsFrom,
  succeededFields,
} from "./inline-edit";
import { suggestEditsAction } from "./actions";
import { adminDirectEditsAction } from "./admin-actions";

/**
 * Field order is reading order, not schema order.
 *
 * `column` is the organisations column the row edits in place — null only for
 * pipeline stage, which has its own audited control in the header.
 *
 * `Type` is the one enum row. It is not a suggestion and never can be:
 * `add_restricted_edit_field` refuses enum-typed columns, so a CAM has nowhere
 * to send a correction to it — but `organisation_type` is in the admin's direct
 * set (admin-actions.ts), so an admin can fix it here. That capability existed
 * and was unreachable: the row was mapped to `column: null`, so nothing ever
 * rendered a control for it. `options` marks the row as a closed set, and
 * `raw` reads the stored enum value — `read` returns the human label, which is
 * what the row displays but not what the column holds.
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
/**
 * Both the row's geometry and the content inside it move on the same eased
 * tween — no spring. A spring, even a bounceless one, spends its last third
 * creeping toward the target, which on a 40px height change reads as the row
 * hesitating rather than settling.
 *
 * The curve is the standard decelerate: quick off the mark, long slow finish,
 * no overshoot. The swap runs shorter than the resize so the content is
 * already in place while the row is still finding its height.
 */
const ROW_TRANSITION = { duration: 0.32, ease: [0.32, 0.72, 0, 1] } as const;
const SWAP_TRANSITION = { duration: 0.18, ease: [0.32, 0.72, 0, 1] } as const;
/**
 * Smooth, slow-paced transition for the draft changes save bar appearing and disappearing.
 * Uses a gentle, fluid decelerate curve so the bar glides into and out of place elegantly.
 */
const DRAFT_BAR_TRANSITION = {
  duration: 0.52,
  ease: [0.16, 1, 0.3, 1],
  opacity: { duration: 0.42 },
} as const;

/**
 * A website column safe to hang an `href` on.
 *
 * The value is whatever a register published, so it can be a bare domain (no
 * scheme means the browser resolves it as a relative path — `/clients/<id>/x`),
 * and in principle anything a `text` column can hold. Only http(s) survives:
 * `javascript:` in this column would otherwise be a stored XSS with a link
 * around it.
 */
function externalUrl(raw: string | null | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(value)
    ? value
    : `https://${value.replace(/^\/+/, "")}`;
  try {
    const url = new URL(candidate);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

/** Google Maps search for the fullest address the record holds. */
function mapsUrl(
  organisation: Pick<
    OrganisationDetailRow,
    "address_line_1" | "city" | "postcode"
  >,
): string | null {
  const query = [
    organisation.address_line_1,
    organisation.city,
    organisation.postcode,
  ]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join(", ");
  if (!organisation.postcode?.trim()) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

/**
 * What the row's button promises, which is not the same act for both roles: an
 * admin writes the value, a CAM proposes one. "Suggest" on an empty row rather
 * than "Suggest edit", because there is nothing there to edit.
 */
function rowActionLabel(isAdmin: boolean, missing: boolean): string {
  if (isAdmin) return missing ? "Add" : "Edit";
  return missing ? "Suggest" : "Suggest edit";
}

const FIELDS: {
  label: string;
  /** Live value, read from panel state so Realtime updates flow through. */
  read: (
    state: BasicInfoState,
    info: ReturnType<typeof buildBasicInfo>,
  ) => string | null;
  /** The organisations column (or `mission_statement`) this row edits. */
  column: string | null;
  /** Stored value behind a formatted `read`, for drafts and change detection. */
  raw?: (state: BasicInfoState) => string | null;
  /** Present when the column is a closed set: the row edits with a select. */
  options?: readonly { value: string; label: string }[];
  /** Where the value points, if anywhere. Opens in a new tab. */
  link?: (state: BasicInfoState) => string | null;
}[] = [
  {
    label: "Registered name",
    read: (state) => state.organisation.legal_name,
    column: "legal_name",
  },
  {
    label: "Mission",
    read: (state) => state.missionStatement,
    column: "mission_statement",
  },
  {
    label: "Type",
    read: (_state, info) => info.type,
    column: "organisation_type",
    raw: (state) => state.organisation.organisation_type,
    options: ORGANISATION_TYPES.map((value) => ({
      value,
      label: formatOrganisationType(value),
    })),
  },
  {
    label: "Pipeline stage",
    read: (_state, info) => info.status,
    column: null,
  },
  {
    label: "Email",
    read: (state) => state.organisation.contact_email,
    column: "contact_email",
  },
  {
    label: "Website",
    read: (state) => state.organisation.website,
    column: "website",
    link: (state) => externalUrl(state.organisation.website),
  },
  {
    label: "Address",
    read: (state) => state.organisation.address_line_1,
    column: "address_line_1",
  },
  {
    label: "Town or city",
    read: (state) => state.organisation.city,
    column: "city",
  },
  {
    label: "Postcode",
    read: (state) => state.organisation.postcode,
    column: "postcode",
    // The whole address, not the postcode on its own: a bare UK postcode
    // resolves to the unit centroid, which can be a few hundred metres and the
    // wrong side of a road from the building someone is trying to visit.
    link: (state) => mapsUrl(state.organisation),
  },
  {
    label: "Country",
    read: (state) => formatCountryName(state.organisation.country_code),
    column: "country_code",
  },
  {
    label: "Geographic reach",
    read: (state) => formatGeographicReach(state.organisation.geographic_reach),
    column: "geographic_reach",
    raw: (state) => state.organisation.geographic_reach ?? null,
    options: GEOGRAPHIC_REACH_OPTIONS,
  },
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
  const [editMode, setEditMode] = useState(false);
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

  /** Columns this viewer may write, in row order. */
  const writableColumns = FIELDS.flatMap(({ column, options }) => {
    if (!column) return [];
    // Mission is not a column on organisations — it is the newest enrichment
    // row — so it can never be a suggestion. An admin writes it directly; a CAM
    // has nowhere to send it.
    if (column === "mission_statement") return isAdmin ? [column] : [];
    // Same shape for an enum column: it can never be in the restricted set, so
    // it is never in `editable` and a CAM has no proposal route for it.
    if (options) return isAdmin ? [column] : [];
    if (!editable.has(column)) return [];
    if (isAdmin) return [column];
    if (!isCam) return [];
    // A field another CAM is already correcting is not offered: the RPC refuses
    // it, and an input that cannot be submitted is worse than no input.
    const blocking = pendingByField.get(column);
    return blocking && blocking.requested_by !== actorId ? [] : [column];
  });

  /** Rows whose draft actually differs from what is on record. */
  const changes = FIELDS.flatMap(({ column, read, raw }) => {
    if (!column) return [];
    const draft = drafts[column];
    if (draft === undefined) return [];
    const value = normaliseFieldValue(column, draft);
    if (!value) return [];
    // Compared against the stored value, not the displayed one: picking
    // "Social enterprise" on a row already holding `social_enterprise` is not a
    // change, and comparing the label would call it one.
    const current = raw ? raw(state) : read(state, info);
    if (isUnchanged(column, draft, current)) return [];
    return [{ fieldName: column, value }];
  });

  /**
   * Opens one row for editing, and makes sure the card is in edit mode — the
   * Add button on an empty row is a shortcut into the same state, not a
   * separate one.
   */
  function openRow(column: string) {
    const row = FIELDS.find((candidate) => candidate.column === column);
    setEditMode(true);
    setEditing((rows) => (rows.includes(column) ? rows : [...rows, column]));
    setDrafts((current) => ({
      ...current,
      [column]:
        current[column] ??
        (row?.raw ? row.raw(state) : row?.read(state, info)) ??
        "",
    }));
  }

  function closeRow(column: string) {
    setEditing((rows) => rows.filter((row) => row !== column));
    setDrafts((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([field]) => field !== column),
      ),
    );
  }

  function discardAll() {
    setEditMode(false);
    setEditing([]);
    setDrafts({});
    setReason("");
    setResult(idleEditBatchState);
  }

  function submit() {
    if (changes.length === 0) return;
    startTransition(async () => {
      const next = isAdmin
        ? await adminDirectEditsAction({
            organisationId: organisation.id,
            changes,
          })
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
      action={
        action ??
        (writableColumns.length > 0 ? (
          /* One control for the whole card, where "Suggest an edit" used to be.
             A pencil on every row, permanently, was six affordances for an act
             that happens once a month, crowding values that are mostly two
             words long. Pressing this does not open anything — it arms the
             card: the rows keep reading as rows and each one this viewer may
             write grows its own Edit button. Opening every input at once was
             the other extreme, and turned a record you were reading into a
             form you had not asked for. */
          <OriginButton
            size="xs"
            variant={editMode ? "outline" : "blue"}
            onClick={() => (editMode ? discardAll() : setEditMode(true))}
            type="button"
          >
            {/* "Done" while nothing has been typed, "Cancel" once something
                has — pressing it throws the drafts away, and a button that
                says Done has no business doing that silently. */}
            {editMode ? (
              changes.length > 0 ? (
                "Cancel"
              ) : (
                "Done"
              )
            ) : (
              <>
                <PencilLine aria-hidden="true" className="size-3.5" />
                {/* A CAM's edit is a proposal an admin has to approve, and a
                    button that says "Edit" promises a change that will not
                    happen when they press Save. */}
                {isAdmin ? "Edit" : "Suggest edits"}
              </>
            )}
          </OriginButton>
        ) : null)
      }
    >
      {/* Label-beside-value rather than label-above-value: these are short
          field names against short values, and stacking them doubled the card's
          height for no gain. */}
      <dl className="mt-3.5 flex flex-col">
        {FIELDS.map(({ label, read, column, raw: readRaw, options, link }) => {
          const rawValue = readRaw ? readRaw(state) : read(state, info);
          const displayed = read(state, info);
          const href = link ? link(state) : null;
          const display = displayed?.trim() ? displayed.trim() : NOT_PROVIDED;
          const missing = display === NOT_PROVIDED;

          const mayEdit = column !== null && writableColumns.includes(column);
          const blocking = column ? pendingByField.get(column) : undefined;
          const blockedByOther =
            !isAdmin &&
            blocking !== undefined &&
            blocking.requested_by !== actorId;
          const isOpen = column !== null && editing.includes(column);

          return (
            /* `layout` on the row, not a height animation on the editor: the
               capsule needs its overflow visible (the droplet flies past its
               own box and the goo filter paints outside it), and animating a
               height means clipping. Letting the row measure both states and
               travel between them keeps the rows below from jumping while the
               input is still on screen. */
            <motion.div
              layout
              transition={ROW_TRANSITION}
              key={label}
              className={`grid gap-x-4 gap-y-0.5 border-t border-rule-soft py-2.5 first:border-t-0 first:pt-0 sm:grid-cols-[132px_minmax(0,1fr)] ${
                isOpen ? "relative z-30" : ""
              }`}
            >
              <dt className="text-[13px] text-dim">{label}</dt>
              <dd
                className={`flex min-w-0 flex-col gap-1.5 text-sm leading-[1.55] ${
                  missing ? "text-faint" : "text-ink"
                }`}
              >
                {/* `wait`, so the outgoing state is gone before the incoming
                    one starts: crossfading a 42px capsule over a line of text
                    reads as a smear, and the row's own layout animation has
                    nothing sensible to measure while both are present. */}
                <AnimatePresence initial={false} mode="wait">
                  {isOpen && column ? (
                    <motion.div
                      key="editing"
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      transition={SWAP_TRANSITION}
                      className="min-w-0"
                    >
                      {options ? (
                        <InlineEnumInput
                          label={label}
                          value={drafts[column] ?? ""}
                          options={options}
                          error={fieldErrors[column]}
                          onChange={(next) =>
                            setDrafts((current) => ({
                              ...current,
                              [column]: next,
                            }))
                          }
                          onCancel={() => closeRow(column)}
                          pending={pending}
                        />
                      ) : column === "city" ? (
                        <InlineCityInput
                          label={label}
                          value={drafts[column] ?? ""}
                          currentValue={rawValue}
                          error={fieldErrors[column]}
                          onChange={(next) =>
                            setDrafts((current) => ({
                              ...current,
                              [column]: next,
                            }))
                          }
                          onCancel={() => closeRow(column)}
                          onSubmit={submit}
                          pending={pending}
                        />
                      ) : (
                        <InlineFieldInput
                          fieldName={column}
                          label={label}
                          value={drafts[column] ?? ""}
                          currentValue={rawValue}
                          error={fieldErrors[column]}
                          onChange={(next) =>
                            setDrafts((current) => ({
                              ...current,
                              [column]: next,
                            }))
                          }
                          onCancel={() => closeRow(column)}
                          onSubmit={submit}
                          pending={pending}
                        />
                      )}
                    </motion.div>
                  ) : (
                    <motion.div
                      key="reading"
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 4 }}
                      transition={SWAP_TRANSITION}
                      className="flex min-w-0 items-center gap-2.5"
                    >
                      {href ? (
                        /* `noreferrer` as well as `noopener`: these are
                           third-party addresses off a public register, and the
                           referrer would leak the client's record URL to them. */
                        <a
                          href={href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex min-w-0 items-center gap-1 break-words text-lead underline decoration-lead/30 underline-offset-2 transition-colors hover:decoration-lead focus-visible:ring-2 focus-visible:ring-lead-mid focus-visible:outline-none"
                        >
                          <span className="min-w-0 break-words">{display}</span>
                          <ExternalLink
                            aria-hidden="true"
                            className="size-3 shrink-0 text-lead/60"
                          />
                          <span className="sr-only"> (opens in a new tab)</span>
                        </a>
                      ) : (
                        <span className="min-w-0 break-words">{display}</span>
                      )}

                      {/* Add is always there on an empty row: a blank is a gap
                        someone can close in one action, and the button is the
                        only thing on an otherwise empty line, so it crowds
                        nothing. Edit appears only once the card is armed. */}
                      {mayEdit && (missing || editMode) && (
                        <button
                          type="button"
                          aria-label={`${rowActionLabel(isAdmin, missing)} ${label.toLowerCase()}`}
                          onClick={() => openRow(column)}
                          className="inline-flex shrink-0 items-center gap-1 rounded-inset border border-rule bg-white px-2 py-0.5 text-[12px] font-semibold text-lead transition-colors hover:border-lead focus-visible:ring-2 focus-visible:ring-lead-mid focus-visible:outline-none"
                        >
                          {missing ? (
                            <>
                              <Plus aria-hidden="true" className="size-3" />
                              {rowActionLabel(isAdmin, true)}
                            </>
                          ) : (
                            <>
                              <Pencil aria-hidden="true" className="size-3" />
                              {rowActionLabel(isAdmin, false)}
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
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* An open proposal by this CAM: the row still shows the live
                    value, because that is what it is until an admin says
                    otherwise. */}
                {blocking && !blockedByOther && !isOpen && (
                  <p className="text-[12px] text-dim">
                    You proposed{" "}
                    <span className="font-semibold text-ink">
                      {blocking.proposed_value}
                    </span>{" "}
                    — awaiting review.
                  </p>
                )}

                {/* A field that failed while its row is shut: the message would
                    otherwise vanish with the input. */}
                {column && !isOpen && fieldErrors[column] && (
                  <p
                    className="text-[12px] font-semibold text-stop"
                    role="alert"
                  >
                    {fieldErrors[column]}
                  </p>
                )}
              </dd>
            </motion.div>
          );
        })}
      </dl>

      <AnimatePresence initial={false}>
        {changes.length > 0 && (
          <motion.div
            key="draft-bar"
            initial={{ opacity: 0, y: -14, scale: 0.98, height: 0, marginTop: 0 }}
            animate={{ opacity: 1, y: 0, scale: 1, height: "auto", marginTop: 16 }}
            exit={{ opacity: 0, y: -14, scale: 0.98, height: 0, marginTop: 0 }}
            transition={DRAFT_BAR_TRANSITION}
            className="overflow-hidden"
          >
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
          </motion.div>
        )}
      </AnimatePresence>

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
