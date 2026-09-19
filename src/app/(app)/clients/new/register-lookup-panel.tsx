"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, Loader2, Search, TriangleAlert } from "lucide-react";

import { Pill } from "../[id]/section-card";
import {
  importRegisterMatch,
  searchRegister,
  type RegisterImportState,
  type RegisterMatch,
  type RegisterSearchState,
} from "./register-lookup-actions";

const INITIAL_SEARCH: RegisterSearchState = { kind: "idle" };
const INITIAL_IMPORT: RegisterImportState = { kind: "idle" };

/**
 * Find the organisation in the registers we already hold, then either fill the
 * form from it or file it.
 *
 * ── Why this is the first thing on the composer ──
 *
 * It is the shortest path and the only one that produces a *complete* record.
 * The other two ways in — reading their website and typing eleven fields — both
 * end at a hand-made organisation with no filed accounts, no registration
 * number, no sector and therefore a score computed against neutrals. A register
 * match arrives with all of it, because it goes through the same promote path a
 * filtered import does.
 *
 * So it leads, and the other two stay below it for the cases it genuinely
 * cannot serve: an organisation not in either file.
 *
 * ── Why two buttons and not one ──
 *
 * Because they are two different jobs and the CAM is the only one who knows
 * which they are doing. "Use these details" is for checking and editing before
 * anything is written; "Import as a client" is for the case where the register
 * is simply right. Neither is a subset of the other — the import cannot be
 * corrected first, and the prefill cannot bring the accounts.
 *
 * ── Why the result is a sentence and a card, not counts ──
 *
 * The same lesson the single-charity lookup on `/admin/charity-commission`
 * learned: somebody typed a name because they want *that organisation*. An
 * integer tells them nothing about which one they got or what to do next, so
 * every match is rendered as the thing itself, with the two ways forward on it.
 */

const MONEY = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  maximumFractionDigits: 0,
});

function shortDate(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/**
 * The register's own facts about one match, in the order they decide anything.
 *
 * Solvency leads because it is the one fact that can make the rest irrelevant,
 * and it is the one the record did not have until now — the regulator publishes
 * it, the import screen has always been able to filter on it, and the client
 * page could never show it.
 */
function MatchFacts({ match }: { match: RegisterMatch }) {
  const items: string[] = [];

  if (match.registryNumber) items.push(`${match.registryName} · ${match.registryNumber}`);
  const registered = shortDate(match.registeredOn);
  if (registered) items.push(`Registered ${registered}`);
  if (match.status) items.push(match.status);
  if (match.latestIncome !== null) items.push(`${MONEY.format(match.latestIncome)} latest income`);
  if (match.postcode) items.push(match.postcode);
  if (match.classifications.length > 0) items.push(match.classifications.slice(0, 3).join(" · "));
  if (match.sicTitles.length > 0) items.push(match.sicTitles.slice(0, 2).join(" · "));

  return (
    <p className="text-[13px] leading-[1.6] text-dim">{items.join(" · ")}</p>
  );
}

function MatchCard({
  match,
  onUseDetails,
  importState,
  importAction,
  importing,
}: {
  match: RegisterMatch;
  onUseDetails: (match: RegisterMatch) => void;
  importState: RegisterImportState;
  importAction: (formData: FormData) => void;
  importing: boolean;
}) {
  const flagged = match.insolvent || match.inAdministration;
  const listed = match.listedOrganisationId !== null;

  return (
    <li className="rounded-panel border border-rule bg-white px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <p className="font-body text-[16px] leading-[1.35] font-semibold tracking-[-0.01em] text-ink">
            {match.name}
          </p>
          <div className="mt-1">
            <MatchFacts match={match} />
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          {match.kind === "charity" ? (
            <Pill tone="lead" dot={false}>
              Charity
            </Pill>
          ) : match.isCic ? (
            <Pill tone="lead" dot={false}>
              CIC
            </Pill>
          ) : (
            <Pill tone="neutral" dot={false}>
              Company
            </Pill>
          )}
          {listed && <Pill tone="go">Already a client</Pill>}
        </div>
      </div>

      {flagged && (
        <p
          className="mt-3 flex items-start gap-2 rounded-inset bg-stop-wash px-3 py-2 text-[13px] leading-[1.55] text-stop"
          role="alert"
        >
          <TriangleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" strokeWidth={2.4} />
          <span>
            The Charity Commission lists this client as{" "}
            <strong className="font-semibold">
              {match.insolvent && match.inAdministration
                ? "insolvent and in administration"
                : match.insolvent
                  ? "insolvent"
                  : "in administration"}
            </strong>
            . Worth confirming before any outreach.
          </span>
        </p>
      )}

      <div className="mt-3.5 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-rule-soft pt-3.5">
        {listed && match.listedOrganisationId ? (
          <Link
            className="group inline-flex items-center gap-1 text-[13px] font-semibold text-lead hover:underline"
            href={`/clients/${match.listedOrganisationId}`}
          >
            Open the client record
            <ArrowRight
              aria-hidden
              className="size-3.5 transition-transform group-hover:translate-x-0.5"
            />
          </Link>
        ) : (
          <>
            <button
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-inset border border-lead bg-lead px-2.5 py-1 text-[13px] font-medium text-white transition-colors hover:bg-lead-mid focus-visible:ring-2 focus-visible:ring-lead/30 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50"
              disabled={importing}
              onClick={() => onUseDetails(match)}
              type="button"
            >
              Use these details
            </button>

            <form action={importAction}>
              <input name="kind" type="hidden" value={match.kind} />
              <input name="key" type="hidden" value={match.key} />
              <button
                className="inline-flex cursor-pointer items-center gap-1.5 text-[13px] font-semibold text-dim transition-colors hover:text-ink disabled:pointer-events-none disabled:opacity-50"
                disabled={importing}
                type="submit"
              >
                {importing && <Loader2 aria-hidden className="size-3.5 animate-spin" strokeWidth={2.2} />}
                Import it as a client
              </button>
            </form>
          </>
        )}
      </div>

      {importState.kind !== "idle" && !importing && (
        <p
          className={`mt-2.5 flex items-start gap-1.5 text-xs font-semibold ${
            importState.kind === "error" ? "text-stop" : "text-go"
          }`}
          role={importState.kind === "error" ? "alert" : "status"}
        >
          {importState.kind === "done" && (
            <Check aria-hidden className="mt-0.5 size-3.5 shrink-0" strokeWidth={2.5} />
          )}
          {importState.message}
        </p>
      )}
    </li>
  );
}

export function RegisterLookupPanel({
  onUseDetails,
}: {
  /** Hands the chosen match up to the form that renders beside this panel. */
  onUseDetails: (match: RegisterMatch) => void;
}) {
  const [search, searchAction, searching] = useActionState(searchRegister, INITIAL_SEARCH);
  const [importState, importAction, importing] = useActionState(
    importRegisterMatch,
    INITIAL_IMPORT,
  );

  // Kept so a failed search does not throw away what was typed, and so the
  // result can say what it searched for rather than leaving the reader to
  // remember.
  const [query, setQuery] = useState("");

  return (
    <div>
      {/* One box for all four ways of knowing an organisation — the server
          reads which one it was given (src/lib/register-search-term.ts). */}
      <form action={searchAction} className="flex flex-wrap items-center gap-3">
        <label className="relative min-w-0 flex-1 basis-64">
          <span className="sr-only">Name, charity or company number, or postcode</span>
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint"
            strokeWidth={2.2}
          />
          <input
            className="h-10 w-full rounded-inset border border-rule bg-white pr-3 pl-9 text-sm text-ink outline-none transition-[border-color,box-shadow] placeholder:text-faint focus-visible:border-lead focus-visible:ring-2 focus-visible:ring-lead/20"
            maxLength={120}
            name="q"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Name, charity or company number, or postcode"
            value={query}
          />
        </label>
        <button
          className="inline-flex h-10 shrink-0 cursor-pointer items-center gap-1.5 rounded-inset border border-lead bg-lead px-3 text-[13px] font-medium text-white transition-colors hover:bg-lead-mid focus-visible:ring-2 focus-visible:ring-lead/30 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50"
          disabled={searching}
          type="submit"
        >
          {searching ? (
            <Loader2 aria-hidden className="size-3.5 animate-spin" strokeWidth={2.2} />
          ) : (
            <Search aria-hidden className="size-3.5" strokeWidth={2.4} />
          )}
          {searching ? "Searching…" : "Search registers"}
        </button>
      </form>

      <p className="mt-2 text-[12.5px] leading-[1.55] text-faint">
        For example <span className="text-dim">Sheffield Community Trust</span>,{" "}
        <span className="text-dim">1012345</span>, <span className="text-dim">01234567</span> or{" "}
        <span className="text-dim">Community Trust S1</span> — add a postcode or town after a name to
        narrow it down.
      </p>

      {search.kind === "error" && (
        <p className="mt-3 rounded-inset bg-stop-wash px-3 py-2 text-[13px] font-semibold text-stop" role="alert">
          {search.message}
        </p>
      )}

      {search.kind === "done" && search.unavailable.length > 0 && (
        <p className="mt-3 rounded-inset bg-hold-wash px-3 py-2 text-[13px] text-hold" role="status">
          {search.unavailable.join(" and ")} could not be read on this deployment, so this
          result covers only what is loaded.
        </p>
      )}

      {search.kind === "done" && search.matches.length === 0 && (
        <p className="mt-3 rounded-inset bg-paper px-3 py-2 text-[13px] leading-[1.6] text-dim">
          Nothing in {search.unavailable.length > 0 ? "the loaded registers" : "either register"} for{" "}
          {search.understood}. The companies file holds a filtered slice of the register, so this
          is not proof the organisation does not exist — add it from its website or by hand.
        </p>
      )}

      {search.kind === "done" && search.matches.length > 0 && (
        <>
          <p className="mt-4 text-[13px] text-dim" role="status">
            {search.matches.length === 1
              ? `One match for ${search.understood}.`
              : `${search.matches.length} matches for ${search.understood} — the closest first.`}
          </p>
          <ul className="mt-2 space-y-3">
            {search.matches.map((match) => (
              <MatchCard
                importAction={importAction}
                importState={importState}
                importing={importing}
                key={`${match.kind}-${match.key}`}
                match={match}
                onUseDetails={onUseDetails}
              />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/** Re-exported so the console can type the callback without importing the action module. */
export type { RegisterMatch };
