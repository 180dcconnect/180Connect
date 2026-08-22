"use client";

import {
  useState,
  useTransition,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { Pencil } from "lucide-react";
import { Checkbox } from "@/components/animate-ui/components/radix/checkbox";
import { Input } from "@/components/ui/input";
import { OriginButton } from "@/components/ui/origin-button";
import { saveOutreachPreferencesAction, type OutreachPreferencesState } from "./actions";
import {
  CITY_PRESETS,
  GEOGRAPHIC_REACH_OPTIONS,
  GEOGRAPHIC_REACH_LABELS,
  INCOME_BAND_OPTIONS,
  INCOME_BAND_LABELS,
  MAX_CITY_LENGTH,
  MAX_CITIES,
  MAX_SECTOR_LENGTH,
  MAX_SECTORS,
  SECTOR_CATEGORY_GROUPS,
  type GeographicReach,
  type IncomeBand,
} from "./constants";

const initialState: OutreachPreferencesState = { status: "idle" };

const LEGEND_CLASS =
  "text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/40";

const CARD =
  "rounded-2xl border border-black/[0.06] bg-white px-6 py-6 shadow-sm";

/**
 * A saved value, shown as a chip. Empty dimensions say so in words instead.
 * Chips carry an explicit `key` rather than keying on the label: the geography
 * summary mixes enum labels with free-text cities, and a city literally named
 * "Local" would otherwise collide with the reach label of the same name.
 */
function Chips({ items }: { items: { key: string; label: string }[] }) {
  if (items.length === 0) {
    return (
      <p className="mt-2 text-sm text-foreground/45">
        No preference — nothing is weighted on this.
      </p>
    );
  }

  return (
    <div className="mt-2.5 flex flex-wrap gap-2">
      {items.map(({ key, label }) => (
        <span
          key={key}
          className="rounded-full bg-brand/10 px-3 py-1 text-sm font-medium text-brand"
        >
          {label}
        </span>
      ))}
    </div>
  );
}

export function OutreachPreferencesForm({
  initialGeographicReach,
  initialCities = [],
  initialSectors,
  initialIncomeBands,
}: {
  initialGeographicReach: GeographicReach[];
  initialCities?: string[];
  initialSectors: string[];
  initialIncomeBands: IncomeBand[];
}) {
  // Submitted through `useTransition` rather than `useActionState`, because this
  // form has to *do* something when the action returns — close the editor and
  // adopt the stored values. With `useActionState` the only place to react to a
  // result is an effect watching it, and deriving `editing` from the result
  // instead is worse: `status` stays "success" for the life of the component,
  // so the Edit button would be dead from the first save onwards.
  const [state, setState] = useState<OutreachPreferencesState>(initialState);
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);

  // What is saved. Updated from what the action echoes back, not from the local
  // draft: the parser trims, deduplicates and caps, and the view should show
  // what was stored rather than what was typed.
  const [savedGeo, setSavedGeo] = useState<GeographicReach[]>(initialGeographicReach);
  const [savedCities, setSavedCities] = useState<string[]>(initialCities);
  const [savedBands, setSavedBands] = useState<IncomeBand[]>(initialIncomeBands);
  const [savedSectors, setSavedSectors] = useState<string[]>(initialSectors);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(async () => {
      const result = await saveOutreachPreferencesAction(state, formData);
      setState(result);
      if (result.status !== "success") return;
      setSavedGeo(result.saved?.geographicReach ?? geo);
      setSavedCities(result.saved?.cities ?? cities);
      setSavedBands(result.saved?.incomeBands ?? bands);
      setSavedSectors(result.saved?.sectors ?? sectors);
      setEditing(false);
    });
  }

  // The in-progress edit.
  const [geo, setGeo] = useState<GeographicReach[]>(initialGeographicReach);
  const [cities, setCities] = useState<string[]>(initialCities);
  const [cityInput, setCityInput] = useState("");
  const [bands, setBands] = useState<IncomeBand[]>(initialIncomeBands);
  const [sectors, setSectors] = useState<string[]>(initialSectors);
  const [sectorInput, setSectorInput] = useState("");

  function startEditing() {
    setGeo(savedGeo);
    setCities(savedCities);
    setCityInput("");
    setBands(savedBands);
    setSectors(savedSectors);
    setSectorInput("");
    // Clears a stale "Preferences saved." from the previous round, so the
    // banner cannot sit above a form that has unsaved changes in it.
    setState(initialState);
    setEditing(true);
  }

  function cancel() {
    setGeo(savedGeo);
    setCities(savedCities);
    setCityInput("");
    setBands(savedBands);
    setSectors(savedSectors);
    setSectorInput("");
    setEditing(false);
  }

  function addCity() {
    const trimmed = cityInput.trim();
    if (!trimmed || trimmed.length > MAX_CITY_LENGTH) return;
    if (cities.length >= MAX_CITIES) return;
    if (cities.some((c) => c.toLowerCase() === trimmed.toLowerCase())) {
      setCityInput("");
      return;
    }
    setCities([...cities, trimmed]);
    setCityInput("");
  }

  function toggleCityPreset(preset: string) {
    if (cities.some((c) => c.toLowerCase() === preset.toLowerCase())) {
      setCities(cities.filter((c) => c.toLowerCase() !== preset.toLowerCase()));
    } else {
      if (cities.length >= MAX_CITIES) return;
      setCities([...cities, preset]);
    }
  }

  function removeCity(cityToRemove: string) {
    setCities(cities.filter((c) => c !== cityToRemove));
  }

  function handleCityKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      addCity();
    } else if (event.key === "Backspace" && cityInput === "" && cities.length > 0) {
      setCities(cities.slice(0, -1));
    }
  }

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

  function toggleSectorPreset(preset: string) {
    if (sectors.some((s) => s.toLowerCase() === preset.toLowerCase())) {
      setSectors(sectors.filter((s) => s.toLowerCase() !== preset.toLowerCase()));
    } else {
      if (sectors.length >= MAX_SECTORS) return;
      setSectors([...sectors, preset]);
    }
  }

  function handleSectorKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      addSector();
    } else if (event.key === "Backspace" && sectorInput === "" && sectors.length > 0) {
      setSectors(sectors.slice(0, -1));
    }
  }

  const allSavedGeography = [
    ...savedGeo.map((value) => ({
      key: `reach:${value}`,
      label: GEOGRAPHIC_REACH_LABELS[value],
    })),
    ...savedCities.map((city) => ({ key: `city:${city}`, label: city })),
  ];

  if (!editing) {
    return (
      <div>
        <div className={`${CARD} space-y-6`}>
          <div className="flex items-start justify-between gap-4">
            <p className="text-sm leading-[1.7] text-foreground/65">
              What your queue is weighted towards today.
            </p>
            <button
              type="button"
              onClick={startEditing}
              className="flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-bold text-brand transition-colors hover:bg-brand/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
            >
              <Pencil className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
              Edit<span className="sr-only"> outreach preferences</span>
            </button>
          </div>

          <div>
            <p className={LEGEND_CLASS}>Geography & Locations</p>
            <Chips items={allSavedGeography} />
          </div>

          <div>
            <p className={LEGEND_CLASS}>Size (annual income)</p>
            <Chips
              items={savedBands.map((value) => ({
                key: `band:${value}`,
                label: INCOME_BAND_LABELS[value],
              }))}
            />
          </div>

          <div>
            <p className={LEGEND_CLASS}>Sector</p>
            <Chips
              items={savedSectors.map((sector) => ({
                key: `sector:${sector}`,
                label: sector,
              }))}
            />
          </div>
        </div>

        {state.status === "success" && state.message ? (
          <p aria-live="polite" className="mt-3 px-1 text-sm font-bold text-brand">
            {state.message}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <div className={`${CARD} space-y-8`}>
        <fieldset>
          <legend className={LEGEND_CLASS}>Geography & Locations</legend>
          <p className="mt-2 text-sm leading-[1.7] text-foreground/65">
            Select broad scope and/or specify target cities (e.g. Sheffield, Rotherham, Leeds) to prioritise matching charities in your queue.
          </p>

          <div className="mt-4">
            <p className="text-xs font-semibold text-foreground/75">Geographic scope</p>
            <div className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-3">
              {GEOGRAPHIC_REACH_OPTIONS.map((option) => (
                <label
                  key={option}
                  htmlFor={`geo-${option}`}
                  className="flex cursor-pointer select-none items-center gap-3 text-sm"
                >
                  <Checkbox
                    id={`geo-${option}`}
                    name="geographic_reach"
                    value={option}
                    size="sm"
                    checked={geo.includes(option)}
                    onCheckedChange={(checked) =>
                      setGeo(
                        checked
                          ? [...geo, option]
                          : geo.filter((value) => value !== option),
                      )
                    }
                  />
                  {GEOGRAPHIC_REACH_LABELS[option]}
                </label>
              ))}
            </div>
          </div>

          <div className="mt-6 border-t border-black/[0.06] pt-5">
            <p className="text-xs font-semibold text-foreground/75">Target cities / regions</p>
            
            {/* Presets */}
            <div className="mt-2 flex flex-wrap gap-1.5">
              {CITY_PRESETS.map((preset) => {
                const isSelected = cities.some((c) => c.toLowerCase() === preset.toLowerCase());
                return (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => toggleCityPreset(preset)}
                    className={`rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors ${
                      isSelected
                        ? "border-brand bg-brand text-white"
                        : "border-black/15 bg-white text-foreground/70 hover:border-brand/40 hover:text-brand"
                    }`}
                  >
                    {isSelected ? `✓ ${preset}` : `+ ${preset}`}
                  </button>
                );
              })}
            </div>

            {/* Active City Tags */}
            <div className="mt-3 flex flex-wrap gap-2">
              {cities.map((city) => (
                <span
                  key={city}
                  className="flex items-center gap-1.5 rounded-full bg-brand/10 px-3 py-1 text-sm font-medium text-brand"
                >
                  {city}
                  <button
                    type="button"
                    onClick={() => removeCity(city)}
                    aria-label={`Remove ${city}`}
                    className="text-brand/70 hover:text-brand"
                  >
                    ×
                  </button>
                  <input type="hidden" name="city" value={city} />
                </span>
              ))}
            </div>

            <Input
              type="text"
              value={cityInput}
              onChange={(event) => setCityInput(event.target.value)}
              onKeyDown={handleCityKeyDown}
              onBlur={addCity}
              maxLength={MAX_CITY_LENGTH}
              disabled={cities.length >= MAX_CITIES}
              aria-label="Add a target city"
              placeholder={
                cities.length >= MAX_CITIES
                  ? `Up to ${MAX_CITIES} cities`
                  : "Type a city (e.g. Sheffield) and press Enter"
              }
              className="mt-3 bg-white"
            />
          </div>
        </fieldset>

        <fieldset>
          <legend className={LEGEND_CLASS}>Size (annual income)</legend>
          <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3">
            {INCOME_BAND_OPTIONS.map((option) => (
              <label
                key={option}
                htmlFor={`band-${option}`}
                className="flex cursor-pointer select-none items-center gap-3 text-sm"
              >
                <Checkbox
                  id={`band-${option}`}
                  name="income_band"
                  value={option}
                  size="sm"
                  checked={bands.includes(option)}
                  onCheckedChange={(checked) =>
                    setBands(
                      checked
                        ? [...bands, option]
                        : bands.filter((value) => value !== option),
                    )
                  }
                />
                {INCOME_BAND_LABELS[option]}
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className={LEGEND_CLASS}>Sector</legend>
          <p className="mt-2 text-sm leading-[1.7] text-foreground/65">
            Select standard sector categories from Charity Commission & Companies House classifications, or type custom tags to prioritise matching organisations.
          </p>

          {/* Categorized Sector Presets */}
          <div className="mt-4 space-y-3">
            {SECTOR_CATEGORY_GROUPS.map((group) => (
              <div key={group.category} className="space-y-1.5">
                <p className="text-[11px] font-semibold text-foreground/60">{group.category}</p>
                <div className="flex flex-wrap gap-1.5">
                  {group.presets.map((preset) => {
                    const isSelected = sectors.some((s) => s.toLowerCase() === preset.toLowerCase());
                    return (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => toggleSectorPreset(preset)}
                        className={`rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors ${
                          isSelected
                            ? "border-brand bg-brand text-white"
                            : "border-black/15 bg-white text-foreground/70 hover:border-brand/40 hover:text-brand"
                        }`}
                      >
                        {isSelected ? `✓ ${preset}` : `+ ${preset}`}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          {/* Active Selected Sectors */}
          {sectors.length > 0 && (
            <div className="mt-5 border-t border-black/[0.06] pt-4">
              <p className="text-xs font-semibold text-foreground/75">Active sector focus ({sectors.length}/{MAX_SECTORS})</p>
              <div className="mt-2.5 flex flex-wrap gap-2">
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
            </div>
          )}

          {/* Custom Sector Input */}
          <div className="mt-4">
            <Input
              type="text"
              value={sectorInput}
              onChange={(event) => setSectorInput(event.target.value)}
              onKeyDown={handleSectorKeyDown}
              onBlur={addSector}
              maxLength={MAX_SECTOR_LENGTH}
              disabled={sectors.length >= MAX_SECTORS}
              aria-label="Add a custom sector"
              placeholder={
                sectors.length >= MAX_SECTORS
                  ? `Up to ${MAX_SECTORS} sectors`
                  : "Type a custom sector (e.g. Mental Health) and press Enter"
              }
              className="bg-white"
            />
          </div>
        </fieldset>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <OriginButton type="submit" loading={pending} disabled={pending} size="md">
          {pending ? "Saving..." : "Save preferences"}
        </OriginButton>
        <OriginButton
          type="button"
          variant="ghost"
          size="md"
          onClick={cancel}
          disabled={pending}
        >
          Cancel
        </OriginButton>
        {state.status === "error" && state.message ? (
          <p aria-live="polite" className="text-sm font-bold text-destructive">
            {state.message}
          </p>
        ) : null}
      </div>
    </form>
  );
}
