"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, Info, Search, TriangleAlert } from "lucide-react";

import { OriginButton } from "@/components/ui/origin-button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/animate-ui/components/radix/dialog";
import {
  lookupCharity,
  previewCharityForImport,
  type CharityCommissionImportState,
  type CharityGrantCoverage,
  type CharityLookupOutcome,
  type CharityPreviewState,
} from "./actions";
import { CharityPreviewCard } from "./charity-preview-card";

/**
 * Fetching one named charity.
 *
 * This was a full card sitting between the import composer and the run history,
 * which gave a rare, unrelated job the same weight as the thing the page is
 * for. It is not part of the import flow at all — different source (the live
 * API, not the staged register), different trigger (somebody named a charity),
 * different frequency. So it is a line you can ignore until you need it, and a
 * dialog when you do.
 *
 * ── Why the result is a sentence and a link, not counts ──
 *
 * It used to render nine integers: the ingestion four, then the promotion five.
 * That is the right shape for a bulk run and the wrong one here. Somebody typed
 * a registration number because they want that charity; "inserted: 1" does not
 * tell them which charity they got, whether it is the one they meant, or how to
 * reach it — the dialog was a dead end, and the reader had to go and find the
 * record by hand.
 *
 * Worse, the most common repeat case scored zero everywhere. Looking up a
 * charity already on the list dedups at the checksum, promotes nothing, and
 * counts as `flagged`, which the old grid never rendered — so it read as a
 * green "imported successfully" over "nothing was waiting to be added". The
 * action now resolves the charity itself (actions.ts `findListedCharity`) and
 * says which of those two things happened, by name, with a link.
 *
 * ── Three phases: search, review, done ──
 *
 * Typing a number used to import the charity in the same breath, so the first
 * time anybody saw its name was after an organisation existed for it — one
 * mistyped digit and a stranger was on the client list, to be found and cleaned
 * up later by somebody who did not know why it was there. The lookup and the
 * import are now two actions with a decision between them: `previewCharityForImport`
 * fetches and shows, `lookupCharity` writes, and nothing is written until
 * somebody looks at the charity and says yes.
 *
 * Two `useActionState` hooks rather than one, because they are two server
 * actions with different result shapes; the phase is derived from them instead
 * of being tracked separately, so it cannot disagree with what is on screen.
 */

const initialLookupState: CharityCommissionImportState = {
  kind: "idle",
  message: "",
};

/**
 * The button names the outcome rather than the mechanism. Promising "add to the
 * client list" for a charity the criteria check will hold or reject would be a
 * promise this screen cannot keep — the verdict is already on the card above it.
 */
const SAVE_LABEL = {
  meets: "Add to the client list",
  needs_review: "Import and hold for review",
  does_not_meet: "Import anyway",
} as const;

/**
 * Grant history as a fact, not an action. The 360Giving backfill queue is
 * ordered nulls-first and runs every quarter hour, so a charity added a moment
 * ago is at the front of it; the client record's own Grant history section has
 * a fetch button for the impatient case. A third trigger here would duplicate
 * both.
 */
function GrantLine({ grants }: { grants: CharityGrantCoverage }) {
  if (grants.status === "queued") {
    return <>Grant history is queued — 360Giving is usually checked within the quarter hour.</>;
  }
  if (grants.count === 0) {
    return <>360Giving has been checked: no grants on record.</>;
  }
  return (
    <>
      {grants.count} grant{grants.count === 1 ? "" : "s"} already on record from 360Giving.
    </>
  );
}

const OUTCOME_TONE = {
  added: {
    surface: "bg-go-wash text-go",
    Icon: Check,
  },
  // Deliberately not the success tone: nothing changed, and a green tick would
  // claim it did. This is an answer to a question, not the result of an action.
  already_listed: {
    surface: "bg-lead-wash text-lead",
    Icon: Info,
  },
  held_for_review: {
    surface: "bg-hold-wash text-hold",
    Icon: TriangleAlert,
  },
  does_not_meet: {
    surface: "bg-hold-wash text-hold",
    Icon: TriangleAlert,
  },
  not_on_list: {
    surface: "bg-hold-wash text-hold",
    Icon: TriangleAlert,
  },
} as const;

function OutcomeCard({
  outcome,
  fallbackMessage,
}: {
  outcome: CharityLookupOutcome;
  fallbackMessage: string;
}) {
  const { surface, Icon } = OUTCOME_TONE[outcome.kind];

  return (
    <div className={`rounded-xl p-4 ${surface}`} role="status">
      <div className="flex items-start gap-2.5">
        <Icon aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2.4} />
        <div className="min-w-0 space-y-1.5">
          {outcome.kind === "added" || outcome.kind === "already_listed" ? (
            <>
              <p className="text-sm font-semibold">
                {outcome.kind === "added"
                  ? `Added ${outcome.name} to the client list.`
                  : `${outcome.name} is already on the client list.`}
              </p>
              <p className="text-[13px] leading-[1.55] opacity-80">
                <GrantLine grants={outcome.grants} />
              </p>
              <Link
                className="group inline-flex items-center gap-1 text-[13px] font-semibold underline underline-offset-2"
                href={`/clients/${outcome.organisationId}`}
              >
                Open the record
                <ArrowRight
                  aria-hidden="true"
                  className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5"
                />
              </Link>
            </>
          ) : (
            <p className="text-sm font-semibold">
              {outcome.kind === "held_for_review"
                ? "That charity was imported but is held for review, so it has not joined the client list yet."
                : outcome.kind === "does_not_meet"
                  ? "That charity does not meet the branch's client criteria, so it was not added."
                  : fallbackMessage}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Everything that survives a single lookup. Split from the dialog so closing it
 * can remount this and clear the result: `useActionState` has no reset, and the
 * trigger stays mounted with the page, so without the remount reopening the
 * dialog showed the previous answer as though it were a fresh one.
 */
function LookupPanel({ configured, onReset }: { configured: boolean; onReset: () => void }) {
  const [preview, previewAction, previewing] = useActionState(
    previewCharityForImport,
    { kind: "idle" } as CharityPreviewState,
  );
  const [result, commitAction, committing] = useActionState(lookupCharity, initialLookupState);

  // Derived, never stored: the commit result wins if there is one, otherwise a
  // successful preview, otherwise the search form. A separate phase variable
  // could fall out of step with the two states it is supposed to describe.
  const phase =
    result.kind !== "idle" ? "done" : preview.kind === "preview" ? "review" : "search";

  if (phase === "done") {
    return (
      <>
        {result.outcome ? (
          <OutcomeCard outcome={result.outcome} fallbackMessage={result.message} />
        ) : (
          // No outcome means the run never got as far as resolving a charity —
          // the API being unreachable, or a promote that failed. The message is
          // the whole answer; there is nothing to link to.
          <div
            className={`rounded-xl p-4 text-sm font-semibold ${
              result.kind === "error" ? "bg-stop-wash text-stop" : "bg-hold-wash text-hold"
            }`}
            role={result.kind === "error" ? "alert" : "status"}
          >
            {result.message}
          </div>
        )}
        <button
          className="text-sm font-semibold text-brand hover:underline"
          onClick={onReset}
          type="button"
        >
          Look up another charity
        </button>
      </>
    );
  }

  if (phase === "review" && preview.kind === "preview") {
    const alreadyListed = preview.alreadyListed;
    return (
      <>
        <CharityPreviewCard preview={preview.preview} alreadyListed={alreadyListed} />

        {/* Only the registration number crosses back to the server. The card
            above is browser-rendered and therefore not evidence of anything —
            see lookupCharity's own note on why it re-fetches. */}
        <form action={commitAction} className="flex flex-wrap items-center gap-3">
          <input
            name="registeredNumber"
            type="hidden"
            value={preview.preview.registeredNumber}
          />
          {alreadyListed ? (
            // Nothing to save: importing again would dedup at the checksum and
            // change nothing. The card already offers the way to the record.
            <button
              className="text-sm font-semibold text-brand hover:underline"
              onClick={onReset}
              type="button"
            >
              Look up another charity
            </button>
          ) : (
            <>
              <OriginButton loading={committing} size="md" type="submit">
                {committing ? "Saving…" : SAVE_LABEL[preview.preview.criteria.outcome]}
              </OriginButton>
              <button
                className="text-sm font-semibold text-dim hover:text-ink"
                onClick={onReset}
                type="button"
              >
                Cancel
              </button>
            </>
          )}
        </form>
      </>
    );
  }

  return (
    <>
      {!configured && (
        <p className="rounded-xl bg-hold-wash p-3 text-sm font-semibold text-hold" role="alert">
          Charity Commission API access is not configured. Add the server-side
          API key before running a lookup.
        </p>
      )}

      <form action={previewAction} className="space-y-4">
        <div>
          <label className="block text-sm font-semibold text-ink" htmlFor="registeredNumber">
            Registration number
          </label>
          <input
            autoComplete="off"
            className="mt-1.5 w-full rounded-lg border border-rule px-3 py-2 text-sm text-ink placeholder:text-faint focus:border-brand focus:ring-1 focus:ring-brand focus:outline-none"
            disabled={!configured || previewing}
            id="registeredNumber"
            // Digits only, matching the adapter's own guard
            // (normalizeRegisteredNumber) and the server action's pre-check, so
            // an obvious typo is caught in the field rather than after a round
            // trip. `pattern` gives the native validation message; inputMode
            // gets the numeric keypad on a phone without type="number", which
            // would add spinners and strip leading characters.
            inputMode="numeric"
            name="registeredNumber"
            pattern="[0-9]+"
            placeholder="For example, 1218781"
            title="Digits only, for example 1218781"
          />
        </div>
        <OriginButton
          disabled={!configured || previewing}
          loading={previewing}
          size="md"
          type="submit"
        >
          {previewing ? "Looking up…" : "Look up charity"}
        </OriginButton>
      </form>

      {preview.kind === "error" && (
        <div className="rounded-xl bg-stop-wash p-4 text-sm font-semibold text-stop" role="alert">
          {preview.message}
        </div>
      )}
    </>
  );
}

export function CharityLookupDialog({ configured }: { configured: boolean }) {
  const [open, setOpen] = useState(false);
  // Bumped on every close so the panel — and the action state inside it —
  // starts clean the next time the dialog is opened.
  const [session, setSession] = useState(0);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setSession((value) => value + 1);
      }}
    >
      <DialogTrigger asChild>
        <button
          type="button"
          className="group inline-flex items-center gap-2 text-sm text-dim transition-colors hover:text-ink"
        >
          <Search className="h-3.5 w-3.5" strokeWidth={2.2} />
          Looking for one particular charity?
          <span className="font-bold text-brand group-hover:underline">
            Look it up by number
          </span>
        </button>
      </DialogTrigger>

      <DialogContent className="max-h-[85vh] space-y-4 overflow-y-auto rounded-2xl sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Look up one charity</DialogTitle>
          <DialogDescription className="leading-[1.65]">
            Fetches a single charity straight from the Charity Commission by its
            registration number, and shows you what it found before anything is
            saved. No filters apply, so this reaches charities well outside the
            branch&rsquo;s usual patch — the standard client checks still run,
            and the result says what they decided.
          </DialogDescription>
        </DialogHeader>

        <LookupPanel
          configured={configured}
          key={session}
          onReset={() => setSession((value) => value + 1)}
        />
      </DialogContent>
    </Dialog>
  );
}
