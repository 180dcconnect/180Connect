"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * F052 (#54) — search by organisation name.
 *
 * F051 already put a `?q=` box in the filter form, which covers AC1-AC2. This
 * component exists for AC4: "clearing the search term returns the full list
 * without requiring a page reload". A `<form method="get">` submit is a full
 * document navigation, so the term is driven from here instead — typing (or
 * clearing) debounces for 300ms then soft-navigates with router.replace, which
 * re-renders the server component without reloading the document.
 *
 * `?q=` stays the source of truth rather than filtering an in-memory copy of the
 * list here: the URL stays shareable, server-side pagination is untouched, and
 * searchClients() stays a pure, unit-tested function. F053-F061 should extend
 * this same param-driven shape rather than each adding their own client state.
 *
 * The current params arrive as props from the page rather than via
 * useSearchParams() — what the Next 16 docs recommend when the page already
 * reads them (see 04-functions/use-search-params.md, "Good to know"), and it
 * avoids the prerendering/Suspense caveat that hook carries.
 */
export function ClientSearch({
  initialTerm,
  ownerFilter,
}: {
  initialTerm: string;
  ownerFilter?: string;
}) {
  const router = useRouter();
  const [term, setTerm] = useState(initialTerm);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const trimmed = term.trim();
    // Nothing to do when the box already matches the URL — stops a redundant
    // navigation on first render, and on the re-render the navigation causes.
    if (trimmed === initialTerm.trim()) return;

    const timer = setTimeout(() => {
      const params = new URLSearchParams();
      if (ownerFilter) params.set("owner", ownerFilter);
      if (trimmed) params.set("q", trimmed);
      // `page` is deliberately dropped: a new search re-shapes the result set,
      // so staying on page 3 of the old one would land on a blank page.
      const qs = params.toString();
      startTransition(() => {
        // replace, not push — a keystroke shouldn't become a Back-button entry.
        // scroll: false — the list is below the box; jumping to the top mid-type
        // makes the page feel like it reloaded, which is what AC4 is about.
        router.replace(qs ? `/clients?${qs}` : "/clients", { scroll: false });
      });
    }, 300);

    return () => clearTimeout(timer);
  }, [term, initialTerm, ownerFilter, router]);

  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-foreground/65">Search</span>
      {/* Relative wrapper so the status line below can be taken out of the
          layout: inside the parent form's `items-end`, an extra child here made
          the search box sit higher than the owner <select> beside it. */}
      <div className="relative">
        <input
          type="search"
          // No `name`: this input sits inside the owner filter's GET form for
          // layout, but must never be submitted by it. The form carries a hidden
          // `q` holding the applied term instead.
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          // Enter inside a form submits it, which is a full document reload —
          // exactly what AC4 rules out, and it would round-trip through the
          // hidden `q` rather than the live one. Suppress it and let the
          // debounce below apply the term as it would for any other keystroke.
          onKeyDown={(event) => {
            if (event.key === "Enter") event.preventDefault();
          }}
          placeholder="Client name"
          className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm"
        />
        <span
          aria-live="polite"
          className="pointer-events-none absolute top-full left-0 pt-1 text-xs text-foreground/50"
        >
          {pending ? "Searching…" : ""}
        </span>
      </div>
    </label>
  );
}
