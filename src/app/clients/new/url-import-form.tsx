"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { OriginButton } from "@/components/ui/origin-button";
import { Input } from "@/components/ui/input";

import { importFromUrl, type UrlImportState } from "./import-actions";

const initialState: UrlImportState = { kind: "idle", message: "" };

const EYEBROW = "text-[11px] font-bold uppercase tracking-[0.12em]";

/**
 * F037 / F256 URL Import Component.
 *
 * Implements Manual URL Import Failure Handling with three visually distinct states:
 *   1. Unreachable / No usable data (Red alert card with specific diagnosis)
 *   2. Insufficient data below threshold (Amber warning card with manual completion prompt)
 *   3. Duplicate / Existing record (Indigo card with existing record summary and merge/discard CTAs)
 */
export function UrlImportForm() {
  const [state, action, pending] = useActionState(importFromUrl, initialState);
  const [discardedDuplicate, setDiscardedDuplicate] = useState(false);

  function scrollToManualForm() {
    const firstInput = document.querySelector<HTMLInputElement>(
      "form input[name='legalName'], form input[name='addressLine1']",
    );
    if (firstInput) {
      firstInput.focus();
      firstInput.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  const isDuplicateActive = state.kind === "duplicate" && state.duplicate && !discardedDuplicate;

  return (
    <section className="rounded-2xl border border-black/[0.06] bg-white p-5 shadow-sm sm:p-6">
      <h2 className={EYEBROW + " text-foreground/40"}>Start from their website</h2>
      <p className="mt-1.5 max-w-prose text-[13px] leading-[1.6] text-foreground/50">
        Paste an organisation&apos;s website URL to retrieve publicly available information,
        identify registration numbers, and pre-fill client details. Nothing is saved until you
        review and submit.
      </p>

      <form action={action} className="mt-4 flex flex-wrap items-end gap-3">
        <label className={`${EYEBROW} min-w-64 flex-1 text-foreground/70`}>
          Website address
          <Input
            className="mt-1.5"
            defaultValue={state.sourceUrl ?? ""}
            inputMode="url"
            maxLength={2000}
            name="sourceUrl"
            placeholder="https://example.org"
            required
            type="url"
          />
        </label>
        <OriginButton
          type="submit"
          loading={pending}
          disabled={pending}
          size="md"
        >
          {pending ? "Reading website…" : "Import from website"}
        </OriginButton>
      </form>

      {/* State 1: URL Unreachable / No Usable Data / System Error (Red) */}
      {(state.kind === "unreachable" || state.kind === "error") && (
        <div
          className="mt-4 rounded-2xl border border-destructive/20 bg-destructive/[0.06] p-5"
          role="alert"
        >
          <div className="flex items-start gap-3">
            <div className="mt-0.5 rounded-full bg-destructive/10 p-1 text-destructive">
              <svg
                aria-hidden="true"
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                viewBox="0 0 24 24"
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="12" x2="12" y1="8" y2="12" />
                <line x1="12" x2="12.01" y1="16" y2="16" />
              </svg>
            </div>
            <div className="flex-1 space-y-1">
              <p className="text-sm font-bold text-destructive">{state.message}</p>
              {state.detail && <p className="text-sm text-destructive/80">{state.detail}</p>}
              <p className="pt-1 text-xs text-destructive/60">
                Tip: Check the URL for typos, or proceed by entering the client details in the form
                below.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* State 2: Data Returned But Below Minimum Threshold / Incomplete Profile (Amber) */}
      {state.kind === "insufficient" && (
        <div
          className="mt-4 rounded-2xl border border-amber-300/60 bg-amber-50/70 p-5"
          role="alert"
        >
          <div className="flex items-start gap-3">
            <div className="mt-0.5 rounded-full bg-amber-100 p-1 text-amber-800">
              <svg
                aria-hidden="true"
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                viewBox="0 0 24 24"
              >
                <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                <line x1="12" x2="12" y1="9" y2="13" />
                <line x1="12" x2="12.01" y1="17" y2="17" />
              </svg>
            </div>
            <div className="flex-1 space-y-2">
              <div>
                <p className="text-sm font-bold text-amber-900">{state.message}</p>
                {state.detail && <p className="mt-0.5 text-sm text-amber-900/85">{state.detail}</p>}
              </div>

              {state.notes && state.notes.length > 0 && (
                <div className="rounded-xl bg-amber-100/60 p-3">
                  <p className={EYEBROW + " text-amber-900"}>
                    Extracted Summary &amp; Missing Details
                  </p>
                  <ul className="mt-1.5 list-disc space-y-1 pl-4 text-xs text-amber-900/90">
                    {state.notes.map((note) => (
                      <li key={note}>{note}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="pt-1">
                <button
                  className="inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-white px-4 py-2 text-xs font-bold text-amber-900 transition-colors hover:bg-amber-100/50"
                  onClick={scrollToManualForm}
                  type="button"
                >
                  <span>Fill in missing fields manually</span>
                  <span aria-hidden="true">↓</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* State 3: Duplicate Record Detected / Existing Charity (Indigo / Blue) */}
      {isDuplicateActive && state.duplicate && (
        <div
          className="mt-4 rounded-2xl border border-indigo-200 bg-indigo-50/70 p-5"
          role="alert"
        >
          <div className="flex items-start gap-3">
            <div className="mt-0.5 rounded-full bg-indigo-100 p-1 text-indigo-800">
              <svg
                aria-hidden="true"
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                viewBox="0 0 24 24"
              >
                <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
                <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
              </svg>
            </div>
            <div className="flex-1 space-y-3">
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-sm font-bold text-indigo-900">{state.message}</p>
                  <span className="rounded-full bg-indigo-200/70 px-2.5 py-0.5 text-[10px] font-bold text-indigo-900 uppercase tracking-[0.1em]">
                    Duplicate Prevention
                  </span>
                </div>
                {state.detail && <p className="mt-0.5 text-sm text-indigo-900/80">{state.detail}</p>}
              </div>

              <div className="rounded-xl border border-indigo-200 bg-white p-3">
                <p className={EYEBROW + " text-foreground/60"}>Existing Client Match</p>
                <p className="mt-1 text-sm font-bold text-indigo-950">
                  {state.duplicate.legalName}
                </p>
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-foreground/75">
                  {state.duplicate.registryNumber && (
                    <span>Registration: {state.duplicate.registryNumber}</span>
                  )}
                  {state.duplicate.postcode && <span>Postcode: {state.duplicate.postcode}</span>}
                  <span className="text-indigo-700">
                    Matched via:{" "}
                    {state.duplicate.matchedOn === "registration_number"
                      ? "Registration Number"
                      : state.duplicate.matchedOn === "name_and_postcode"
                        ? "Name and Postcode"
                        : "Website Address"}
                  </span>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2.5 pt-1">
                <Link
                  className="inline-flex items-center gap-1.5 rounded-full bg-indigo-700 px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-indigo-800"
                  href={`/clients/${state.duplicate.organisationId}`}
                >
                  <span>View existing client profile</span>
                  <span aria-hidden="true">→</span>
                </Link>
                <button
                  className="rounded-full border border-indigo-300 bg-white px-4 py-2 text-xs font-bold text-indigo-900 transition-colors hover:bg-indigo-100/50"
                  onClick={() => setDiscardedDuplicate(true)}
                  type="button"
                >
                  Discard import
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}