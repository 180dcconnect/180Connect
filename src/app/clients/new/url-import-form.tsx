"use client";

import { useActionState, useState } from "react";
import { OriginButton } from "@/components/ui/origin-button";
import { TriangleAlert, Info, Copy } from "lucide-react";

import { importFromUrl, type UrlImportState } from "./import-actions";

const initialState: UrlImportState = { kind: "idle", message: "" };

/**
 * F037 / F256 URL Import Component.
 *
 * Implements Manual URL Import Failure Handling with three visually distinct states:
 *   1. Unreachable / No usable data (Red alert card with specific diagnosis)
 *   2. Insufficient data below threshold (Amber warning card)
 *   3. Duplicate / Existing record (Indigo card with existing record summary and merge/discard CTAs)
 *
 * Rendered inside the page's white floating card, so content only — no outer border.
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

  const alertCard =
    "rounded-2xl border px-5 py-4 text-sm";
  const iconDisc =
    "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full";

  return (
    <>
      <div>
        <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-brand">
          Start from their website
        </p>
        <p className="mt-1 text-sm leading-[1.7] text-foreground/65">
          Paste an organisation&apos;s website URL to retrieve publicly available information,
          identify registration numbers, and pre-fill client details. Nothing is saved until you
          review and submit.
        </p>
      </div>

      <form action={action} className="mt-4 flex flex-wrap items-end gap-3">
        <label className="min-w-64 flex-1 flex flex-col gap-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/70">
          Website address
          <input
            className="mt-0.5 h-10 w-full rounded-lg border border-black/15 bg-white px-3 text-sm font-medium normal-case tracking-normal outline-none transition-[border-color,box-shadow] focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/20 placeholder:text-foreground/35"
            defaultValue={state.sourceUrl ?? ""}
            inputMode="url"
            maxLength={2000}
            name="sourceUrl"
            placeholder="https://example.org"
            required
            type="url"
          />
        </label>
        <OriginButton type="submit" loading={pending} disabled={pending} size="md">
          {pending ? "Reading website…" : "Import from website"}
        </OriginButton>
      </form>

      {/* State 1: URL Unreachable / No Usable Data / System Error (Red) */}
      {(state.kind === "unreachable" || state.kind === "error") && (
        <div className={`mt-4 ${alertCard} border-destructive/25 bg-destructive/[0.05]`} role="alert">
          <div className="flex items-start gap-3">
            <div className={`${iconDisc} bg-destructive/10 text-destructive`}>
              <TriangleAlert className="h-4 w-4" aria-hidden="true" />
            </div>
            <div className="flex-1 space-y-1">
              <p className="font-bold text-destructive">{state.message}</p>
              {state.detail && <p className="text-foreground/70">{state.detail}</p>}
              <p className="pt-1 text-xs text-foreground/50">
                Tip: Check the URL for typos, or proceed by entering the client details in the form
                below.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* State 2: Data Returned But Below Minimum Threshold / Incomplete Profile (Amber) */}
      {state.kind === "insufficient" && (
        <div className={`mt-4 ${alertCard} border-amber-500/25 bg-amber-500/[0.06]`} role="alert">
          <div className="flex items-start gap-3">
            <div className={`${iconDisc} bg-amber-500/15 text-amber-800`}>
              <Info className="h-4 w-4" aria-hidden="true" />
            </div>
            <div className="flex-1 space-y-2">
              <div>
                <p className="font-bold text-amber-800">{state.message}</p>
                {state.detail && <p className="mt-0.5 text-foreground/70">{state.detail}</p>}
              </div>

              {state.notes && state.notes.length > 0 && (
                <div className="rounded-xl border border-amber-500/15 bg-amber-500/[0.06] p-3">
                  <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-amber-800">
                    Extracted summary &amp; missing details
                  </p>
                  <ul className="mt-1.5 list-disc space-y-1 pl-4 text-xs text-foreground/70">
                    {state.notes.map((note) => (
                      <li key={note}>{note}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="pt-1">
                <OriginButton
                  variant="outline"
                  size="sm"
                  onClick={scrollToManualForm}
                  type="button"
                >
                  Fill in missing fields manually ↓
                </OriginButton>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* State 3: Duplicate Record Detected / Existing Charity (Indigo / Blue) */}
      {isDuplicateActive && state.duplicate && (
        <div className={`mt-4 ${alertCard} border-indigo-500/25 bg-indigo-500/[0.06]`} role="alert">
          <div className="flex items-start gap-3">
            <div className={`${iconDisc} bg-indigo-500/15 text-indigo-800`}>
              <Copy className="h-4 w-4" aria-hidden="true" />
            </div>
            <div className="flex-1 space-y-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-bold text-indigo-900">{state.message}</p>
                  <span className="rounded-full bg-indigo-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] text-indigo-800">
                    Duplicate prevention
                  </span>
                </div>
                {state.detail && <p className="mt-0.5 text-foreground/70">{state.detail}</p>}
              </div>

              <div className="rounded-xl border border-indigo-500/15 bg-white p-3">
                <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/40">
                  Existing client match
                </p>
                <p className="mt-1 text-sm font-bold text-indigo-950">{state.duplicate.legalName}</p>
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
                <OriginButton
                  variant="default"
                  size="sm"
                  href={`/clients/${state.duplicate.organisationId}`}
                >
                  View existing client profile →
                </OriginButton>
                <OriginButton
                  variant="ghost"
                  size="sm"
                  className="border border-black/10"
                  onClick={() => setDiscardedDuplicate(true)}
                  type="button"
                >
                  Discard import
                </OriginButton>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}