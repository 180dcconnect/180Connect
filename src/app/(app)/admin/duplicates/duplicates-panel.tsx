"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronsUpDown, X } from "lucide-react";

import { Pill, SectionCard } from "@/app/(app)/clients/[id]/section-card";
import { BrandSearchBar, type FilterOption } from "@/components/brand/search-bar";
import { InlineAlert } from "@/components/ui/inline-alert";
import { VIEW_ONLY_CONTROL_NOTE } from "@/lib/auth/view-only";
import { formatShortDate } from "@/lib/display-format";
// Type-only, deliberately: `@/lib/duplicates` reads register payloads, so it
// pulls in the source mappers and belongs on the server. Nothing this component
// needs at runtime comes from there — the decided window's size is a prop.
import type {
  ComparisonRow,
  EntityMatchCandidateRow,
  PendingReview,
  QueueRecord,
} from "@/lib/duplicates";
import { reportError } from "@/lib/error-logging";
import { NETWORK_ERROR_MESSAGE } from "@/lib/network-error";
import { MergeDialog, type FieldWinners } from "./merge-dialog";

/**
 * F042's review queue — the pending pairs, and what has been decided.
 *
 * Rebuilt on the app's Filed Record language (docs/app-design-system.md) with the
 * Data imports screens as the structure reference. The pairs were always right;
 * what the old version could not say was why a row is here, what an answer does,
 * and who reads this screen without being able to answer it. Every one of those
 * is now on the page:
 *
 * - **The two records, side by side.** The decision is "same charity, or two?"
 *   and the old screen showed one side of it: a name, or often nothing at all.
 *   Each pending card now sets the register's copy of the incoming record beside
 *   the client's — name, both registration numbers, postcode, address, website
 *   and latest income — and marks the rows where the two disagree, so the answer
 *   can be reached from the page rather than from memory.
 * - **What the incoming record is.** A flagged record is on no list at all — the
 *   import held it instead of adding it — and nothing said so. Each card opens by
 *   saying it, and the client it looks like is named and linked, so the pair can
 *   be read before it is answered rather than after.
  * - **What each answer does.** Keeping one record opens the winning-details
  *   dialog (`merge-dialog.tsx`) before anything saves: every detail the two
  *   copies disagree on, each starting on what's already on the client record,
  *   and confirming applies the picks with the decision — so "same charity"
  *   never means "keep everything blindly". Calling them different charities
  *   returns the record to the importer. A pick the save cannot apply falls
  *   back to the Data discrepancies queue rather than being lost quietly.
 * - **The warning the route has always sent.** A confirmation whose conflict
 *   check fails still commits (correctly — the check is a follow-up, not part of
 *   the decision), and the API reports it as `{ ok: true, warning }`. The old
 *   panel read only `error`, so the one outcome that needs a person was the
 *   quietest thing on the screen.
 * - **A fold per card.** Waiting cards start unfolded — the comparison is what
 *   the decision is made from — and each one folds to a summary that still
 *   names the client it looks like and how many details disagree, so a grown
 *   queue scans as a list and answers one card at a time. A half-written note
 *   survives a fold.
 * - **One search over both lists.** The clients list's own `BrandSearchBar`
 *   (`tone="light"`, local `onSubmitQuery` filtering like the
 *   incomplete-records queue), asking one name search of the waiting pairs and
 *   the decided history together, with how-they-were-matched and what-was-
 *   decided as pick-lists rather than typed text.
 *
 * ── What a viewer sees ──
 *
 * Leadership reads every screen and answers none of them: the pairs, both
 * records, the client links, the decisions already taken and the notes stay
 * whole. The note field and the two buttons are replaced by
 * `VIEW_ONLY_CONTROL_NOTE` — the PATCH route asks the same permission
 * (`approval:manage`), so a button here could only ever be a refusal.
 *
 * Both records are read on the server (`@/lib/duplicates`) and handed to this
 * component as props: reading a register payload means knowing which source
 * wrote it, and that lives next to the mappers, not in a browser bundle.
 */

type Notice = { tone: "success" | "warning" | "error"; text: string };

/**
 * The buttons and field, in the Data imports console's own shape
 * (`import-console.tsx`'s New import, `annual-return-card.tsx`'s backfill):
 * `rounded-inset`, lead solid for the answer that keeps the client list as it
 * is, an outline for the answer that changes it.
 */
const PRIMARY_BUTTON =
  "inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-inset border border-lead bg-lead px-2.5 py-1 text-[13px] font-medium text-white transition-colors hover:bg-lead-mid focus-visible:ring-2 focus-visible:ring-lead/30 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50";

const SECONDARY_BUTTON =
  "inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-inset border border-rule bg-white px-2.5 py-1 text-[13px] font-medium text-ink transition-colors hover:border-lead/40 hover:bg-lead-wash focus-visible:ring-2 focus-visible:ring-lead/30 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50";

const NOTE_FIELD =
  "mt-1.5 w-full rounded-inset border border-rule bg-white px-3 py-2 text-sm text-ink outline-none focus:border-lead disabled:opacity-50";

const LINK =
  "font-semibold text-lead transition-colors hover:text-lead-mid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lead";

/**
 * The decision in the words of the decision rather than the words of the column.
 * `confirmed_new` is not "new record confirmed" to an admin — it means the two
 * charities are different and the incoming one is added on its own.
 *
 * `rejected` is part of the status enum — a future matcher's "this pairing was
 * wrong" outcome — but `decide_duplicate_flag` never writes it (see the
 * migration header), so it gets a label and a tone for the row it cannot
 * produce, not because this flow can.
 */
const DECISION_LABEL: Record<EntityMatchCandidateRow["match_status"], string> = {
  pending: "Waiting",
  confirmed_match: "Same charity",
  confirmed_new: "Different charities",
  rejected: "Rejected",
};

/**
 * Tones from the app's own set. Neither answer is a failure, so neither is
 * `stop`: keeping one record is housekeeping (`neutral`) and separating two
 * charities puts a new client on the list (`go`). The queue's own state is the
 * only `hold` on this screen.
 */
const DECISION_TONE: Record<
  EntityMatchCandidateRow["match_status"],
  "go" | "hold" | "stop" | "neutral"
> = {
  pending: "hold",
  confirmed_match: "neutral",
  confirmed_new: "go",
  rejected: "stop",
};

// F042's matcher only ever produces exact_charity_number or fuzzy_name (the
// migration header explains why address_match/manual are reserved for a matcher
// this table anticipates); all four are labelled so a row can never render
// without saying how it was matched.
const MATCH_METHOD_LABEL: Record<EntityMatchCandidateRow["match_method"], string> = {
  exact_charity_number: "registration number",
  fuzzy_name: "name and postcode",
  address_match: "address",
  manual: "manual entry",
};

/**
 * The search bar's filter categories, in the words of the job rather than the
 * words of the columns: how the importer paired the two records, and — for
 * pairs already answered — what the answer was. Chosen from lists, never
 * typed, so a wrong answer is impossible rather than rejected.
 */
const MATCH_FILTER_CATEGORY = "How it was matched";
const DECISION_FILTER_CATEGORY = "Decision";

type AppliedFilter = FilterOption & { category: string };

/**
 * Which register the incoming record came from, named the way the rest of the
 * app names it. The column header says this rather than a generic "the register"
 * because "the register" is two different registers here, and which one a record
 * came from is part of reading it.
 */
const REGISTER_LABEL: Record<string, string> = {
  charity_commission: "the Charity Commission",
  charity_commission_bulk: "the Charity Commission",
  companies_house: "Companies House",
  find_that_charity: "Find That Charity",
};

function registerLabel(source: string | null | undefined): string {
  return (source && REGISTER_LABEL[source]) || "the register";
}

/** Who decided a pair. `A former team member` matches `lib/actions.ts`. */
function personLabel(person: { full_name: string | null; email: string } | null): string {
  if (!person) return "A former team member";
  return person.full_name ?? person.email;
}

/**
 * The client a candidate points at, linked so the record can be opened and read
 * before the pair is answered.
 */
function ClientName({ row }: { row: EntityMatchCandidateRow }) {
  const name = row.candidate_organisation?.legal_name?.trim();
  if (!name) return null;
  if (!row.candidate_organisation_id) {
    return <span className="font-semibold text-ink">{name}</span>;
  }
  return (
    <Link href={`/clients/${row.candidate_organisation_id}`} className={LINK}>
      {name}
    </Link>
  );
}

/**
 * The two records, one row per field.
 *
 * A real table rather than a grid of divs: it is a comparison of two records
 * across the same fields, which is what a table means, and it gives every cell a
 * row and column header for anyone reading it with a screen reader. The `differs`
 * marker sits under the field's own label so a scan down the labels column finds
 * every disagreement without reading either value.
 */
function ComparisonTable({
  rows,
  clientId,
  registerSource,
}: {
  rows: ComparisonRow[];
  clientId: string | null;
  registerSource: string | null | undefined;
}) {
  return (
    <div className="mt-3.5 overflow-x-auto">
      <table className="w-full min-w-[32rem] border-collapse text-left">
        <caption className="sr-only">
          What the register published about this charity, beside what the client record holds.
        </caption>
        <thead>
          <tr className="border-b border-rule">
            <th
              scope="col"
              className="w-[8.5rem] pr-3 pb-1.5 align-bottom font-body text-[12px] font-medium text-faint"
            >
              <span className="sr-only">Detail</span>
            </th>
            <th
              scope="col"
              className="pr-4 pb-1.5 align-bottom font-body text-[12px] font-medium text-dim"
            >
              From {registerLabel(registerSource)}
            </th>
            <th
              scope="col"
              className="pb-1.5 align-bottom font-body text-[12px] font-medium text-dim"
            >
              Already a client
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-rule-soft">
          {rows.map((row) => (
            <tr key={row.key}>
              <th
                scope="row"
                className="py-2 pr-3 align-top font-body text-[12.5px] font-medium text-dim"
              >
                {row.label}
                {row.differs && (
                  <span className="mt-0.5 block font-body text-[11.5px] font-semibold text-hold">
                    differs
                  </span>
                )}
              </th>
              <td className="py-2 pr-4 align-top font-body text-[13.5px] leading-[1.5] break-words text-ink">
                {row.register ?? "—"}
              </td>
              <td className="py-2 align-top font-body text-[13.5px] leading-[1.5] break-words text-ink">
                {row.key === "name" && row.client !== null && clientId ? (
                  <Link href={`/clients/${clientId}`} className={LINK}>
                    {row.client}
                  </Link>
                ) : (
                  (row.client ?? "—")
                )}
                {row.clientNote && (
                  <span className="mt-0.5 block font-body text-[11.5px] text-faint">
                    {row.clientNote}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** What the decision was, said as what it did. */
function OutcomeText({ row }: { row: EntityMatchCandidateRow }) {
  const hasClient = Boolean(row.candidate_organisation?.legal_name?.trim());

  switch (row.match_status) {
    case "confirmed_match":
      return (
        <>
          Kept as one record
          {hasClient && (
            <>
              {" "}
              with <ClientName row={row} />
            </>
          )}
          .
        </>
      );
    case "confirmed_new":
      return (
        <>
          Treated as two charities —
          {hasClient && (
            <>
              {" "}
              <ClientName row={row} /> stays as it is, and
            </>
          )}{" "}
          the importer adds this one as its own client next time it runs.
        </>
      );
    case "rejected":
      return (
        <>The importer withdrew this pairing itself; nobody on the team decided it.</>
      );
    case "pending":
      return null;
  }
}

/** One pair waiting on an answer. */
function PendingCard({
  flag,
  canDecide,
  busy,
  note,
  onNote,
  onDecide,
  expanded,
  onToggle,
}: {
  flag: PendingReview;
  canDecide: boolean;
  busy: boolean;
  note: string;
  onNote: (value: string) => void;
  /**
   * Answers a pair. Resolves to the failure text, or null when the decision
   * saved — the merge dialog keeps the admin's picks on a failure so a retry
   * costs nothing. `compared` is false when the dialog never managed to compare
   * the two copies, so the success message must not claim they agreed.
   */
  onDecide: (
    confirmed: boolean,
    winners?: FieldWinners,
    compared?: boolean,
  ) => Promise<string | null>;
  /** Whether the comparison and the decision controls are unfolded. */
  expanded: boolean;
  onToggle: () => void;
}) {
  const { row, comparison } = flag;
  const clientId = row.candidate_organisation_id;
  const hasClient = Boolean(row.candidate_organisation?.legal_name?.trim());
  // The merge dialog lives per card: opening it is the confirmation for
  // "same charity", so there is no way to keep one record without seeing —
  // and being able to change — which copy wins each disagreeing detail.
  const [mergeOpen, setMergeOpen] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const detailsId = `candidate-${row.id}-details`;
  const diffCount = comparison.filter((item) => item.differs).length;

  return (
    <SectionCard
      headingId={`candidate-${row.id}`}
      title={flag.name}
      hint={`Matched on ${MATCH_METHOD_LABEL[row.match_method]} · flagged ${formatShortDate(row.created_at)}`}
      action={<Pill tone="hold">Needs a decision</Pill>}
      fold={{
        expanded,
        onToggle,
        controlsId: detailsId,
        label: `${expanded ? "Hide" : "Show"} details for ${flag.name}`,
      }}
    >
      {/* Part of the fold's handle: tapping anywhere from the name down to
          here unfolds or folds the card. The client link inside still
          navigates — taps that belong to it are left alone. */}
      <p
        onClick={(event) => {
          if ((event.target as HTMLElement).closest("a, button")) return;
          onToggle();
        }}
        className="mt-2 cursor-pointer font-body text-[13px] leading-[1.6] text-dim"
      >
        {hasClient ? (
          <>
            Looks like <ClientName row={row} /> ·{" "}
            {diffCount === 0
              ? "both copies agree"
              : diffCount === 1
                ? "1 detail differs"
                : `${diffCount} details differ`}
          </>
        ) : (
          "No client record is linked to this flag."
        )}
      </p>

      <div
        id={detailsId}
        data-expanded={expanded}
        aria-hidden={!expanded}
        inert={!expanded}
        className="card-collapse-grid"
      >
        <div>
          <p className="mt-3.5 font-body text-[13px] leading-[1.65] text-dim">
            Not on the client list yet — the import held it here instead of adding it.
            {!hasClient && " No client record is linked to this flag."}
          </p>

          {hasClient && comparison.length > 0 && (
            <ComparisonTable
              rows={comparison}
              clientId={clientId}
              registerSource={row.raw_source_record?.record_source}
            />
          )}

          <p className="mt-3 font-body text-[12.5px] leading-[1.6] text-dim">
            The left column is what the register published on the record that was imported; the right is
            the client record today. Where the two disagree the row says so — ignoring capitalisation,
            punctuation and the usual Ltd/Limited wording. Choosing “same charity” opens the winning
            details for a final check, starting with what&apos;s already on the client record.
            {clientId && (
              <>
                {" "}
                <Link href={`/clients/${clientId}`} className={LINK}>
                  Open the full client record
                </Link>
              </>
            )}
          </p>

          <div className="mt-4 border-t border-rule-soft pt-4">
            {canDecide ? (
              <>
                <label
                  htmlFor={`note-${row.id}`}
                  className="font-body text-[13px] font-medium text-dim"
                >
                  Note (optional — kept with the decision)
                </label>
                <textarea
                  id={`note-${row.id}`}
                  className={NOTE_FIELD}
                  disabled={busy}
                  onChange={(event) => onNote(event.target.value)}
                  rows={2}
                  value={note}
                />
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className={PRIMARY_BUTTON}
                    disabled={busy}
                    onClick={() => {
                      setSaveError(null);
                      setMergeOpen(true);
                    }}
                  >
                    Same charity — keep one record
                  </button>
                  <button
                    type="button"
                    className={SECONDARY_BUTTON}
                    disabled={busy}
                    onClick={() => {
                      void onDecide(false);
                    }}
                  >
                    Different charities — add as a separate client
                  </button>
                </div>
              </>
            ) : (
              <p className="font-body text-[13px] leading-[1.55] text-dim">
                {VIEW_ONLY_CONTROL_NOTE}
              </p>
            )}
          </div>
        </div>
      </div>
      {mergeOpen && (
        <MergeDialog
          flag={flag}
          saving={busy}
          saveError={saveError}
          onCancel={() => {
            if (!busy) setMergeOpen(false);
          }}
          onSave={async (winners, compared) => {
            const error = await onDecide(true, winners, compared);
            setSaveError(error);
            if (!error) setMergeOpen(false);
          }}
        />
      )}
    </SectionCard>
  );
}

/** One answered pair. */
function DecidedRow({ flag }: { flag: QueueRecord }) {  const { row } = flag;

  return (
    <>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1.5">
        <p className="min-w-0 font-body text-[14px] font-semibold break-words text-ink">
          {flag.name}
        </p>
        <Pill tone={DECISION_TONE[row.match_status]} dot={false}>
          {DECISION_LABEL[row.match_status]}
        </Pill>
      </div>
      <p className="mt-1 font-body text-[13px] leading-[1.55] text-dim">
        <OutcomeText row={row} /> · {personLabel(row.reviewed_by_user)},{" "}
        {formatShortDate(row.reviewed_at ?? row.created_at)}
      </p>
      {row.notes && (
        <p className="mt-1 font-body text-[13px] leading-[1.55] break-words text-ink">
          Note: {row.notes}
        </p>
      )}
    </>
  );
}

/**
 * Whether one flagged pair matches the search bar's typed query. The query is
 * a name search across both copies of the record — the incoming name, the
 * client's name, and every compared value (numbers, postcode, address,
 * website) — plus, for answered pairs, the note and who decided it. One
 * question, asked of both lists, so a single search narrows the queue and the
 * history together.
 */
function flagMatchesQuery(flag: PendingReview | QueueRecord, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const haystacks: (string | null | undefined)[] = [
    flag.name,
    flag.row.candidate_organisation?.legal_name,
    flag.row.notes,
    flag.row.reviewed_by_user?.full_name,
    flag.row.reviewed_by_user?.email,
  ];
  if ("comparison" in flag) {
    for (const item of flag.comparison) {
      haystacks.push(item.register, item.client);
    }
  }
  return haystacks.some((value) => value?.toLowerCase().includes(needle));
}

export function DuplicatesPanel({
  initialPending,
  initialDecided,
  canDecide,
  decidedLimit,
}: {
  initialPending: PendingReview[];
  initialDecided: QueueRecord[];
  /**
   * Whether this reader may answer a pair. False for leadership, who see every
   * pair and decide none of them — the PATCH route asks the same permission.
   */
  canDecide: boolean;
  /** How many decisions the read took (`DECIDED_LIMIT`), so the caveat under the history is honest. */
  decidedLimit: number;
}) {
  const [pending, setPending] = useState(initialPending);
  const [decided, setDecided] = useState(initialDecided);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchFilters, setSearchFilters] = useState<AppliedFilter[]>([]);
  /**
   * Folded waiting cards, by flag id. Unfolded is the default: the comparison
   * is what the decision is made from, so hiding it behind a tap would ask an
   * admin to open every card before doing anything. Folding is for the queue
   * that has grown — scan the summaries, open the one you came for — and a
   * half-written note survives a fold because notes live here, not in the card.
   */
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());

  function toggleCard(flagId: string) {
    setCollapsedIds((current) => {
      const next = new Set(current);
      if (next.has(flagId)) next.delete(flagId);
      else next.add(flagId);
      return next;
    });
  }

  // The pick-lists offer only what is actually on screen: a queue matched
  // purely on registration numbers offers no "name and postcode" choice.
  const searchCategories = useMemo<Record<string, FilterOption[]>>(() => {
    const methods = new Map<string, string>();
    for (const flag of [...pending, ...decided]) {
      methods.set(flag.row.match_method, MATCH_METHOD_LABEL[flag.row.match_method]);
    }
    const decisions = new Map<string, string>();
    for (const flag of decided) {
      decisions.set(flag.row.match_status, DECISION_LABEL[flag.row.match_status]);
    }
    return {
      [MATCH_FILTER_CATEGORY]: [...methods].map(([value, label]) => ({ label, value })),
      [DECISION_FILTER_CATEGORY]: [...decisions].map(([value, label]) => ({ label, value })),
    };
  }, [pending, decided]);

  const matchValues = useMemo(
    () =>
      searchFilters
        .filter((filter) => filter.category === MATCH_FILTER_CATEGORY)
        .map((filter) => filter.value),
    [searchFilters],
  );
  const decisionValues = useMemo(
    () =>
      searchFilters
        .filter((filter) => filter.category === DECISION_FILTER_CATEGORY)
        .map((filter) => filter.value),
    [searchFilters],
  );

  const filteredPending = useMemo(
    () =>
      pending.filter(
        // A waiting pair has no decision yet, so the Decision filter cannot
        // narrow it — it narrows the history below instead. Filtering the
        // queue out from under a decision pick would read as the queue
        // disappearing.
        (flag) =>
          flagMatchesQuery(flag, searchQuery) &&
          (matchValues.length === 0 || matchValues.includes(flag.row.match_method)),
      ),
    [pending, searchQuery, matchValues],
  );
  const filteredDecided = useMemo(
    () =>
      decided.filter(
        (flag) =>
          flagMatchesQuery(flag, searchQuery) &&
          (matchValues.length === 0 || matchValues.includes(flag.row.match_method)) &&
          (decisionValues.length === 0 || decisionValues.includes(flag.row.match_status)),
      ),
    [decided, searchQuery, matchValues, decisionValues],
  );

  const isFiltering =
    searchQuery.trim() !== "" || matchValues.length > 0 || decisionValues.length > 0;

  function clearSearch() {
    setSearchQuery("");
    setSearchFilters([]);
  }

  const allVisibleExpanded =
    filteredPending.length > 0 &&
    filteredPending.every((flag) => !collapsedIds.has(flag.row.id));

  function toggleAllVisible() {
    setCollapsedIds((current) => {
      const next = new Set(current);
      if (allVisibleExpanded) {
        for (const flag of filteredPending) next.add(flag.row.id);
      } else {
        for (const flag of filteredPending) next.delete(flag.row.id);
      }
      return next;
    });
  }

  async function refresh() {
    const response = await fetch("/api/admin/duplicates");
    if (!response.ok) return;
    const body = await response.json();
    setPending(body.pending as PendingReview[]);
    setDecided(body.decided as QueueRecord[]);
  }

  async function decide(
    row: EntityMatchCandidateRow,
    confirmed: boolean,
    winners?: FieldWinners,
    compared = true,
  ): Promise<string | null> {
    setBusy(true);
    setNotice(null);
    try {
      const response = await fetch("/api/admin/duplicates", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entityMatchCandidateId: row.id,
          confirmed,
          note: notes[row.id] ?? "",
          // Winners only mean something when one record survives.
          ...(confirmed && winners ? { fieldChoices: winners } : {}),
        }),
      });
      const body = (await response.json()) as {
        error?: string;
        warning?: string;
        appliedIncoming?: number;
        appliedTotal?: number;
      };
      if (!response.ok) {
        const text = body.error ?? "The decision could not be saved.";
        setNotice({ tone: "error", text });
        return text;
      }

      // The decision is committed before the field-by-field conflict check runs,
      // so a check that fails comes back as a success with a warning attached
      // (the route has always sent this — see its own comment). It belongs on
      // screen: nothing was lost, but this pair now needs a person.
      const appliedTotal = typeof body.appliedTotal === "number" ? body.appliedTotal : 0;
      const appliedIncoming =
        typeof body.appliedIncoming === "number" ? body.appliedIncoming : 0;
      const done = confirmed
        ? appliedTotal === 0
          ? compared
            ? "Kept as one record. Both copies already agreed, so nothing about the client changed."
            : "Kept as one record. The details the two disagree on, if any, are flagged under Data discrepancies."
          : appliedIncoming === 0
            ? "Kept as one record. The client record stays exactly as it was."
            : `Kept as one record — took ${appliedIncoming === 1 ? "1 detail" : `${appliedIncoming} details`} from the register; everything else stays as it was.`
        : "Treated as two charities — the importer adds it as its own client next time it runs.";
      setNotice(
        body.warning
          ? { tone: "warning", text: `${done} ${body.warning}` }
          : { tone: "success", text: done },
      );

      // The note is spent once the decision is in; leaving it in state would
      // strand the text on a row that has already moved to the history below.
      setNotes((current) => {
        const next = { ...current };
        delete next[row.id];
        return next;
      });
      await refresh();
      return null;
    } catch (err) {
      void reportError(err, { operation: "admin.duplicates.decide_client" });
      setNotice({ tone: "error", text: NETWORK_ERROR_MESSAGE });
      return NETWORK_ERROR_MESSAGE;
    } finally {
      setBusy(false);
    }
  }

  const decidedCapped = decided.length >= decidedLimit;

  return (
    <div className="space-y-6">
      {/* Errors announce themselves (`role="alert"` inside InlineAlert), so they
          render outside the live region rather than nested in it — two live
          regions around one message is how a screen reader reads it twice.
          Everything else needs a region that was already on the page when the
          message arrives, which is what this always-mounted wrapper is;
          `empty:hidden` keeps an empty region from adding a gap between cards. */}
      {notice?.tone === "error" ? (
        <InlineAlert tone="error" message={notice.text} />
      ) : (
        <div aria-live="polite" className="empty:hidden">
          {notice && <InlineAlert tone={notice.tone} message={notice.text} />}
        </div>
      )}

      {pending.length === 0 ? (
        <p className="rounded-panel border border-dashed border-rule bg-white px-5 py-6 font-body text-sm leading-[1.65] text-dim">
          {decided.length === 0
            ? "Nothing has been held for a duplicate check yet. When an import finds a client that looks like one already on the client list, it appears here."
            : "Nothing is waiting for a decision. Anything the importer flags from now on appears here."}
        </p>
      ) : (
        <section aria-labelledby="waiting-heading" className="relative space-y-4">
          {/* Sticky search rail: the bar looks like it sits beside the heading,
              but it rides its own full-height column so it stays put while the
              queue scrolls — the approvals history's shape, not a second
              invention. The rail is click-through; only the bar takes the
              pointer. */}
          <div className="pointer-events-none absolute inset-x-0 -top-1.5 bottom-0 z-40">
            <div className="sticky top-3 flex justify-end">
              <div className="pointer-events-auto w-full sm:w-[380px] lg:w-[440px]">
                <BrandSearchBar
                  tone="light"
                  clearRowOnOpen
                  chipsBelow={false}
                  filters={searchFilters}
                  placeholder="Search"
                  subjects={["client names", "postcodes", "registration numbers"]}
                  categories={searchCategories}
                  params={{
                    [MATCH_FILTER_CATEGORY]: "matched",
                    [DECISION_FILTER_CATEGORY]: "decision",
                  }}
                  onQueryChange={(query) => setSearchQuery(query)}
                  onSubmitQuery={(query, filters) => {
                    setSearchQuery(query);
                    setSearchFilters(filters);
                  }}
                />
              </div>
            </div>
          </div>

          {/* Heading reserves the rail's width, so the two never overlap and
              the arrangement reads as one row. */}
          <div className="flex min-h-[64px] flex-col justify-center pt-[72px] sm:pt-0 sm:pr-[400px] lg:pr-[460px]">
            <h2
              id="waiting-heading"
              className="font-body text-[18px] leading-[1.3] font-semibold tracking-[-0.01em] text-ink"
            >
              Waiting for a decision
            </h2>
            <p className="mt-0.5 text-[13px] leading-[1.55] text-dim">
              Showing {filteredPending.length.toLocaleString()} of{" "}
              {pending.length.toLocaleString()} waiting{" "}
              {filteredPending.length === 1 ? "client" : "clients"}
              {isFiltering && " matching this search"}
            </p>
            {searchFilters.length > 0 && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {searchFilters.map((filter) => (
                  <span
                    key={`${filter.category}-${filter.value}`}
                    className="relative z-30 inline-flex items-center gap-1.5 rounded-full border border-rule bg-paper px-2.5 py-0.5 text-[12px] font-semibold text-ink"
                  >
                    <span>{filter.label}</span>
                    <button
                      type="button"
                      onClick={() => {
                        setSearchFilters((current) =>
                          current.filter(
                            (entry) =>
                              !(
                                entry.category === filter.category &&
                                entry.value === filter.value
                              ),
                          ),
                        );
                      }}
                      aria-label={`Remove ${filter.label} filter`}
                      className="flex size-3.5 cursor-pointer items-center justify-center rounded-full bg-black/5 transition-colors hover:bg-black/15"
                    >
                      <X className="size-2.5" aria-hidden="true" />
                    </button>
                  </span>
                ))}
                <button
                  type="button"
                  onClick={clearSearch}
                  className="relative z-30 cursor-pointer text-[12px] font-semibold text-lead hover:underline"
                >
                  Clear search and filters
                </button>
              </div>
            )}
          </div>

          {filteredPending.length > 0 && (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={toggleAllVisible}
                className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-inset border border-rule bg-white px-3 py-1.5 font-body text-[12px] font-semibold text-ink transition-colors hover:bg-paper focus-visible:ring-2 focus-visible:ring-lead/30 focus-visible:outline-none"
              >
                <ChevronsUpDown className="size-3.5 text-dim" aria-hidden="true" />
                {allVisibleExpanded ? "Collapse visible" : "Expand visible"}
              </button>
            </div>
          )}

          {filteredPending.length === 0 ? (
            <div className="rounded-panel border border-dashed border-rule bg-white px-6 py-10 text-center">
              <p className="text-sm font-medium text-ink">No waiting charities match this search</p>
              <p className="mt-1 text-xs text-dim">
                Try a different name, postcode or registration number.
              </p>
              <button
                type="button"
                onClick={clearSearch}
                className="mt-3 inline-flex cursor-pointer text-xs font-semibold text-lead hover:underline"
              >
                Clear search and filters
              </button>
            </div>
          ) : (
            <ul className="space-y-4">
              {filteredPending.map((flag) => (
                <li key={flag.row.id}>
                  <PendingCard
                    flag={flag}
                    canDecide={canDecide}
                    busy={busy}
                    note={notes[flag.row.id] ?? ""}
                    onNote={(value) =>
                      setNotes((current) => ({ ...current, [flag.row.id]: value }))
                    }
                    onDecide={(confirmed, winners, compared) =>
                      decide(flag.row, confirmed, winners, compared)
                    }
                    expanded={!collapsedIds.has(flag.row.id)}
                    onToggle={() => toggleCard(flag.row.id)}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section aria-labelledby="decided-heading">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-1">
          <h2
            id="decided-heading"
            className="font-body text-[18px] leading-[1.3] font-semibold tracking-[-0.01em] text-ink"
          >
            Already decided
          </h2>
          {decidedCapped && (
            <p className="font-body text-[13px] text-dim">
              The {decidedLimit.toLocaleString()} most recent
            </p>
          )}
        </div>
        {isFiltering && decided.length > 0 && (
          <p className="mt-1 px-1 font-body text-[13px] text-dim">
            Showing {filteredDecided.length.toLocaleString()} of{" "}
            {decided.length.toLocaleString()} decided{" "}
            {filteredDecided.length === 1 ? "pair" : "pairs"} matching this search.
          </p>
        )}

        {decided.length === 0 ? (
          <p className="mt-3 rounded-panel border border-dashed border-rule bg-white px-5 py-6 font-body text-sm leading-[1.65] text-dim">
            Nothing has been decided yet.
          </p>
        ) : filteredDecided.length === 0 ? (
          <div className="mt-3 rounded-panel border border-dashed border-rule bg-white px-6 py-10 text-center">
            <p className="text-sm font-medium text-ink">No decided pairs match this search</p>
            <p className="mt-1 text-xs text-dim">
              Try a different name, postcode or registration number.
            </p>
            <button
              type="button"
              onClick={clearSearch}
              className="mt-3 inline-flex cursor-pointer text-xs font-semibold text-lead hover:underline"
            >
              Clear search and filters
            </button>
          </div>
        ) : (
          <div className="mt-3 overflow-hidden rounded-panel border border-rule bg-white">
            <ul className="divide-y divide-rule-soft">
              {filteredDecided.map((flag) => (
                <li key={flag.row.id} className="px-5 py-3.5">
                  <DecidedRow flag={flag} />
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}
