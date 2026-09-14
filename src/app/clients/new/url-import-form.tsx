"use client";

import { startTransition, useActionState, useState } from "react";
import { OriginButton } from "@/components/ui/origin-button";
import { GooeyEmailInput } from "@/components/ui/gooey-email-input";
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
  // Controlled so a failed import keeps what was typed in the capsule.
  const [url, setUrl] = useState(state.sourceUrl ?? "");

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
    "rounded-panel border px-5 py-4 text-sm";
  const iconDisc =
    "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full";

  return (
    <>
      {/* The booklet's website capsule: resting, it reads "Website address";
          tapped, it becomes the field and its droplet separates into the
          import arrow. `-ml-3` because a start-aligned capsule is inset 12px
          inside its stage, and the field should line up with the text above.
          While the import runs the arrow itself wears the spinning AI
          pinwheel — the loading lives on the control that was tapped, so no
          separate loader line is needed below. */}
      <div className="-ml-3 flex items-center justify-start overflow-x-clip py-1">
        <GooeyEmailInput
          align="start"
          buttonIcon="arrow"
          disabled={pending}
          duration={900}
          fieldLabel="Website address"
          fieldWidth={340}
          gap={56}
          inputType="url"
          loadingIcon="pinwheel"
          maxLength={2000}
          onSubmit={(value) => {
            const formData = new FormData();
            formData.set("sourceUrl", value.trim());
            startTransition(() => action(formData));
          }}
          onValueChange={setUrl}
          placeholder="https://example.org"
          restPlaceholder="Website address"
          size="md"
          submitLabel="Import from website"
          submitting={pending}
          // No success words: the import reports through its own result cards
          // below, and the default ("Subscribed…") belongs to another context.
          successPlaceholder=""
          validate={(value) => (value.trim() ? null : "Enter the website address")}
          value={url}
          variant="light"
        />
      </div>

      {/* State 1: URL Unreachable / No Usable Data / System Error (Red) */}
      {(state.kind === "unreachable" || state.kind === "error") && (
        <div className={`mt-4 ${alertCard} border-stop/25 bg-stop-wash`} role="alert">
          <div className="flex items-start gap-3">
            <div className={`${iconDisc} bg-stop-wash text-stop`}>
              <TriangleAlert className="h-4 w-4" aria-hidden="true" />
            </div>
            <div className="flex-1 space-y-1">
              <p className="font-semibold text-stop">{state.message}</p>
              {state.detail && <p className="text-dim">{state.detail}</p>}
              <p className="pt-1 text-xs text-faint">
                Tip: Check the URL for typos, or proceed by entering the client details in the form
                below.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* State 2: Data Returned But Below Minimum Threshold / Incomplete Profile (Amber) */}
      {state.kind === "insufficient" && (
        <div className={`mt-4 ${alertCard} border-hold/25 bg-hold-wash`} role="alert">
          <div className="flex items-start gap-3">
            <div className={`${iconDisc} bg-hold-wash text-hold`}>
              <Info className="h-4 w-4" aria-hidden="true" />
            </div>
            <div className="flex-1 space-y-2">
              <div>
                <p className="font-semibold text-hold">{state.message}</p>
                {state.detail && <p className="mt-0.5 text-dim">{state.detail}</p>}
              </div>

              {state.notes && state.notes.length > 0 && (
                <div className="rounded-inset border border-hold/15 bg-hold-wash p-3">
                  <p className="text-[13px] font-semibold text-hold">
                    Extracted summary &amp; missing details
                  </p>
                  <ul className="mt-1.5 list-disc space-y-1 pl-4 text-xs text-dim">
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

      {/* State 3: Duplicate Record Detected / Existing Charity */}
      {isDuplicateActive && state.duplicate && (
        <div className={`mt-4 ${alertCard} border-lead/25 bg-lead-wash`} role="alert">
          <div className="flex items-start gap-3">
            <div className={`${iconDisc} bg-lead-wash text-lead`}>
              <Copy className="h-4 w-4" aria-hidden="true" />
            </div>
            <div className="flex-1 space-y-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold text-lead">{state.message}</p>
                  <span className="rounded-full bg-lead-wash px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] text-lead">
                    Duplicate prevention
                  </span>
                </div>
                {state.detail && <p className="mt-0.5 text-dim">{state.detail}</p>}
              </div>

              <div className="rounded-inset border border-lead/15 bg-white p-3">
                <p className="text-[13px] font-semibold text-dim">
                  Existing client match
                </p>
                <p className="mt-1 text-sm font-bold text-ink">{state.duplicate.legalName}</p>
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-dim">
                  {state.duplicate.registryNumber && (
                    <span>Registration: {state.duplicate.registryNumber}</span>
                  )}
                  {state.duplicate.postcode && <span>Postcode: {state.duplicate.postcode}</span>}
                  <span className="text-lead">
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