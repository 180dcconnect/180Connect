"use client";

import { useActionState, useState, type KeyboardEvent } from "react";
import { Input } from "@/components/ui/input";
import { OriginButton } from "@/components/ui/origin-button";
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

const LEGEND_CLASS =
  "text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/40";

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
    <form action={formAction} noValidate>
      <div className="space-y-8 rounded-2xl border border-black/[0.06] bg-white px-6 py-6 shadow-sm">
        <fieldset>
          <legend className={LEGEND_CLASS}>
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
          <legend className={LEGEND_CLASS}>
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
          <legend className={LEGEND_CLASS}>
            Sector
          </legend>
          <p className="mt-2 text-sm leading-[1.7] text-foreground/65">
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
          <Input
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
            className="mt-3 bg-white"
          />
        </fieldset>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-4">
        <OriginButton
          type="submit"
          loading={pending}
          disabled={pending}
          size="md"
        >
          {pending ? "Saving..." : "Save preferences"}
        </OriginButton>
        <p aria-live="polite" className="text-sm font-bold">
          {state.message ? (
            <span className={state.status === "error" ? "text-destructive" : "text-brand"}>
              {state.message}
            </span>
          ) : null}
        </p>
      </div>
    </form>
  );
}
