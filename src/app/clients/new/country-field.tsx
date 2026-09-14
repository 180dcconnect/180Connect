"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check } from "lucide-react";

import { COUNTRY_OPTIONS, isoToFlagEmoji, type CountryOption } from "@/lib/country-flags";

const BY_CODE = new Map(COUNTRY_OPTIONS.map((option) => [option.code, option]));

/**
 * Country, chosen by name.
 *
 * The record stores an ISO code (`country_code`), but nobody should have to know
 * that Ireland is IE. The person searches and picks a name; the code rides along
 * in a hidden input under the name the server action already reads.
 *
 * The code only changes on a pick, never on a keystroke: flipping between UK
 * and another country re-shapes the address fields (a UK town comes from a list,
 * a UK postcode is checked), and doing that while someone is halfway through
 * typing "United" would throw away what they typed below.
 */
export function CountryField({
  id,
  defaultCode,
  onCodeChange,
}: {
  id: string;
  defaultCode: string;
  onCodeChange: (code: string) => void;
}) {
  const listId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const initial = BY_CODE.get(defaultCode.toUpperCase()) ?? BY_CODE.get("GB") ?? null;
  const [code, setCode] = useState(initial?.code ?? "");
  const [text, setText] = useState(initial?.name ?? "");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const selected = BY_CODE.get(code) ?? null;
  const settled = selected !== null && text === selected.name;

  const suggestions = useMemo(() => {
    const needle = text.trim().toLowerCase();
    if (!needle || settled) return COUNTRY_OPTIONS.slice(0, 60);
    const starts: CountryOption[] = [];
    const contains: CountryOption[] = [];
    for (const option of COUNTRY_OPTIONS) {
      const name = option.name.toLowerCase();
      if (name.startsWith(needle)) starts.push(option);
      else if (name.includes(needle) || option.code.toLowerCase() === needle) contains.push(option);
    }
    return [...starts, ...contains].slice(0, 60);
  }, [text, settled]);

  const message = settled ? null : "Choose a country from the list.";

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

  function choose(option: CountryOption) {
    setCode(option.code);
    setText(option.name);
    setOpen(false);
    if (option.code !== code) onCodeChange(option.code);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
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
      event.preventDefault();
      choose(suggestions[active]);
    } else if (event.key === "Escape" && open) {
      event.preventDefault();
      setOpen(false);
    }
  }

  const flag = settled ? isoToFlagEmoji(code) : null;

  return (
    <div className={`relative mt-1.5 ${open ? "z-40" : ""}`} ref={containerRef}>
      <input name="countryCode" type="hidden" value={settled ? code : ""} />
      <div className="relative">
        {flag && (
          <span aria-hidden className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-base leading-none">
            {flag}
          </span>
        )}
        <input
          aria-autocomplete="list"
          aria-controls={listId}
          aria-expanded={open}
          autoComplete="off"
          className={`h-10 w-full rounded-inset border border-rule bg-white pr-3 text-sm outline-none transition-[border-color,box-shadow] focus-visible:border-lead focus-visible:ring-2 focus-visible:ring-lead/20 ${
            flag ? "pl-10" : "pl-3"
          }`}
          id={id}
          onChange={(event) => {
            setText(event.target.value);
            setOpen(true);
            setActive(0);
          }}
          onFocus={(event) => {
            event.target.select();
            setOpen(true);
          }}
          onKeyDown={handleKeyDown}
          placeholder="Search countries"
          ref={inputRef}
          required
          role="combobox"
          type="text"
          value={text}
        />
      </div>

      <AnimatePresence>
        {open && suggestions.length > 0 && (
          <motion.div
            animate={{ opacity: 1, y: 0 }}
            className="absolute top-full left-0 z-50 mt-1.5 max-h-64 w-full overflow-y-auto rounded-panel border border-rule bg-white p-1 shadow-xl shadow-black/10"
            exit={{ opacity: 0, y: -4 }}
            id={listId}
            initial={{ opacity: 0, y: -4 }}
            role="listbox"
            transition={{ duration: 0.16 }}
          >
            {suggestions.map((option, index) => (
              <button
                aria-selected={option.code === code}
                className={`flex w-full items-center justify-between gap-2 rounded-inset px-2.5 py-1.5 text-left text-[13px] ${
                  index === active ? "bg-paper" : ""
                }`}
                key={option.code}
                onClick={() => choose(option)}
                onMouseMove={() => setActive(index)}
                role="option"
                type="button"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span aria-hidden className="text-base leading-none">
                    {isoToFlagEmoji(option.code)}
                  </span>
                  <span className="truncate font-medium text-ink">{option.name}</span>
                </span>
                {option.code === code && <Check aria-hidden className="size-3.5 shrink-0 text-lead" strokeWidth={2.5} />}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
