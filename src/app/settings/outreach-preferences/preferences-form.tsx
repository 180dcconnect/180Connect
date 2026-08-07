"use client";

import { useActionState, useState, type KeyboardEvent } from "react";
import { saveOutreachPreferencesAction, type OutreachPreferencesState } from "./actions";
import {
  GEOGRAPHIC_REACH_OPTIONS,
  GEOGRAPHIC_REACH_LABELS,
  INCOME_BAND_OPTIONS,
  INCOME_BAND_LABELS,
  MAX_SECTOR_LENGTH,
  MAX_SECTORS,
  type GeographicReach,
  type IncomeBand,
} from "./constants";

const initialState: OutreachPreferencesState = { status: "idle" };

const checkboxClassName =
  "size-4 rounded border-black/25 text-brand focus-visible:ring-2 focus-visible:ring-brand/20";

export function OutreachPreferencesForm({
  initialGeographicReach,
  initialSectors,
  initialIncomeBands,
}: {
  initialGeographicReach: GeographicReach[];
  initialSectors: string[];
  initialIncomeBands: IncomeBand[];
}) {
  const [state, formAction, pending] = useActionState(
    saveOutreachPreferencesAction,
    initialState,
  );
  const [sectors, setSectors] = useState<string[]>(initialSectors);
  const [sectorInput, setSectorInput] = useState("");

  function addSector() {
    const trimmed = sectorInput.trim();
    if (!trimmed || trimmed.length > MAX_SECTOR_LENGTH) return;
    if (sectors.length >= MAX_SECTORS) return;
    if (sectors.some((s) => s.toLowerCase() === trimmed.toLowerCase())) {
      setSectorInput("");
      return;
    }
    setSectors([...sectors, trimmed]);
    setSectorInput("");
  }

  function removeSector(sector: string) {
    setSectors(sectors.filter((s) => s !== sector));
  }

  function handleSectorKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      addSector();
    } else if (event.key === "Backspace" && sectorInput === "" && sectors.length > 0) {
      setSectors(sectors.slice(0, -1));
    }
  }

  return (
    <form action={formAction} className="mt-6 space-y-8" noValidate>
      <fieldset>
        <legend className="text-xs font-bold uppercase tracking-wide text-foreground/60">
          Geography
        </legend>
        <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2">
          {GEOGRAPHIC_REACH_OPTIONS.map((option) => (
            <label key={option} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="geographic_reach"
                value={option}
                defaultChecked={initialGeographicReach.includes(option)}
                className={checkboxClassName}
              />
              {GEOGRAPHIC_REACH_LABELS[option]}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="text-xs font-bold uppercase tracking-wide text-foreground/60">
          Size (annual income)
        </legend>
        <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2">
          {INCOME_BAND_OPTIONS.map((option) => (
            <label key={option} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="income_band"
                value={option}
                defaultChecked={initialIncomeBands.includes(option)}
                className={checkboxClassName}
              />
              {INCOME_BAND_LABELS[option]}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="text-xs font-bold uppercase tracking-wide text-foreground/60">
          Sector
        </legend>
        <p className="mt-1 text-xs text-foreground/60">
          Type a sector and press Enter to add it.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {sectors.map((sector) => (
            <span
              key={sector}
              className="flex items-center gap-1.5 rounded-full bg-brand/10 px-3 py-1 text-sm font-medium text-brand"
            >
              {sector}
              <button
                type="button"
                onClick={() => removeSector(sector)}
                aria-label={`Remove ${sector}`}
                className="text-brand/70 hover:text-brand"
              >
                ×
              </button>
              <input type="hidden" name="sector" value={sector} />
            </span>
          ))}
        </div>
        <input
          type="text"
          value={sectorInput}
          onChange={(event) => setSectorInput(event.target.value)}
          onKeyDown={handleSectorKeyDown}
          onBlur={addSector}
          maxLength={MAX_SECTOR_LENGTH}
          disabled={sectors.length >= MAX_SECTORS}
          placeholder={
            sectors.length >= MAX_SECTORS ? `Up to ${MAX_SECTORS} sectors` : "e.g. Education"
          }
          className="mt-3 h-10 w-full rounded-lg border border-black/15 bg-white px-3 text-sm outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/20"
        />
      </fieldset>

      <div className="flex items-center gap-4">
        <button
          type="submit"
          disabled={pending}
          className="h-10 rounded-full bg-brand px-5 text-sm font-bold text-white transition-colors hover:bg-brand-hover disabled:cursor-wait disabled:opacity-60"
        >
          {pending ? "Saving..." : "Save preferences"}
        </button>
        <p aria-live="polite" className="text-sm font-bold">
          {state.message ? (
            <span className={state.status === "error" ? "text-red-700" : "text-brand"}>
              {state.message}
            </span>
          ) : null}
        </p>
      </div>
    </form>
  );
}
