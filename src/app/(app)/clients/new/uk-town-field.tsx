"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, MapPin } from "lucide-react";

import { UK_CITIES, formatUkCity, searchUkCities } from "@/lib/uk-cities";

const KNOWN = new Set(UK_CITIES.map((city) => city.name.toLowerCase()));

/**
 * Town or city for a UK client, chosen from the app's list of UK cities and
 * towns — the same list the client record's own "Town or city" editor offers —
 * so `organisations.city` carries one spelling per place and the /clients city
 * filter does not grow a "Sheffield", "SHEFFIELD" and "Sheffield City Centre".
 *
 * `strict` is the UK case: anything not on the list fails validation, the way a
 * select would, but with type-to-search over a few hundred places. For a client
 * outside the UK the list is irrelevant and the field is free text.
 *
 * The input itself carries `name="city"`, so the form stays uncontrolled; the
 * picked value is also handed up for the section summary, because a programmatic
 * value change fires no change event for the form to hear.
 */
export function UkTownField({
  id,
  defaultValue,
  strict,
  onValueChange,
  className,
}: {
  id: string;
  defaultValue: string;
  strict: boolean;
  onValueChange: (value: string) => void;
  className: string;
}) {
  const listId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [touched, setTouched] = useState(false);

  const suggestions = useMemo(() => (strict ? searchUkCities(text, 8) : []), [strict, text]);
  const invalid = strict && text.trim() !== "" && !KNOWN.has(text.trim().toLowerCase());
  const message = invalid ? "Choose a town or city from the list — or the nearest one to them." : null;

  useEffect(() => {
    inputRef.current?.setCustomValidity(message ?? "");
  }, [message]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function choose(name: string) {
    const formatted = formatUkCity(name);
    setText(formatted);
    onValueChange(formatted);
    setOpen(false);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!strict) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        setActive(0);
        return;
      }
      if (suggestions.length === 0) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((current) => (current + step + suggestions.length) % suggestions.length);
    } else if (event.key === "Enter" && open && suggestions[active]) {
      // Picking from the list, not submitting the form.
      event.preventDefault();
      choose(suggestions[active].name);
    } else if (event.key === "Escape" && open) {
      event.preventDefault();
      setOpen(false);
    }
  }

  return (
    <div className={`relative ${open ? "z-40" : ""}`} ref={containerRef}>
      <div className="relative">
        {strict && (
          <MapPin
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3 mt-[3px] size-4 -translate-y-1/2 text-faint"
          />
        )}
        <input
          aria-autocomplete={strict ? "list" : undefined}
          aria-controls={strict ? listId : undefined}
          aria-expanded={strict ? open : undefined}
          aria-invalid={touched && invalid ? true : undefined}
          autoComplete="off"
          className={`${className} ${strict ? "pl-9" : ""}`}
          id={id}
          maxLength={200}
          name="city"
          onBlur={() => setTouched(true)}
          onChange={(event) => {
            setText(event.target.value);
            if (strict) {
              setOpen(true);
              setActive(0);
            }
          }}
          onFocus={() => strict && setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={strict ? "Search UK towns and cities" : undefined}
          ref={inputRef}
          required
          role={strict ? "combobox" : undefined}
          type="text"
          value={text}
        />
      </div>

      <AnimatePresence>
        {strict && open && suggestions.length > 0 && (
          <motion.div
            animate={{ opacity: 1, y: 0 }}
            className="absolute top-full left-0 z-50 mt-1.5 w-full rounded-panel border border-rule bg-white p-1 shadow-xl shadow-black/10"
            exit={{ opacity: 0, y: -4 }}
            id={listId}
            initial={{ opacity: 0, y: -4 }}
            role="listbox"
            transition={{ duration: 0.16 }}
          >
            {suggestions.map((city, index) => {
              const selected = text.trim().toLowerCase() === city.name.toLowerCase();
              return (
                <button
                  aria-selected={selected}
                  className={`flex w-full items-center justify-between gap-2 rounded-inset px-2.5 py-1.5 text-left text-[13px] ${
                    index === active ? "bg-paper" : ""
                  }`}
                  key={`${city.name}-${city.region}`}
                  onClick={() => choose(city.name)}
                  onMouseMove={() => setActive(index)}
                  role="option"
                  type="button"
                >
                  <span className="flex min-w-0 items-baseline gap-2">
                    <span className="truncate font-medium text-ink">{city.name}</span>
                    <span className="truncate text-[11.5px] text-faint">{city.region}</span>
                  </span>
                  {selected && <Check aria-hidden className="size-3.5 shrink-0 text-lead" strokeWidth={2.5} />}
                </button>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>

      {touched && message && <p className="mt-1.5 text-[12.5px] text-stop">{message}</p>}
    </div>
  );
}
