"use client";

import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * The dashboard's door for the CAM who arrives with a client's name in mind.
 *
 * Every other route into the list starts at the whole pipeline: "View all
 * clients" opens `/clients` and the search rail lives *inside* that page, so
 * finding one record meant opening the list and then searching it. This lands
 * on the list already filtered.
 *
 * It submits `q`, which is `/clients`' literal name search (F052) — not `ask`,
 * the plain-English question F214 answers — because someone typing here has a
 * name, not a question.
 *
 * A real search form with a submit handler rather than a bare `<Link>`: the
 * value only exists in the browser, and a native GET form would throw away the
 * app shell on the way to a page that is one client-side navigation away.
 * Enter and the magnifier both work; an empty box goes to the unfiltered list
 * rather than nowhere.
 */
export function ClientSearch({ className = "" }: { className?: string }) {
  const router = useRouter();
  const [term, setTerm] = useState("");

  return (
    <form
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
        const query = term.trim();
        router.push(query ? `/clients?q=${encodeURIComponent(query)}` : "/clients");
      }}
      className={`relative w-full sm:w-[280px] ${className}`}
    >
      <label htmlFor="dashboard-client-search" className="sr-only">
        Search clients by name
      </label>
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-faint"
      />
      <input
        id="dashboard-client-search"
        name="q"
        type="search"
        value={term}
        onChange={(event) => setTerm(event.target.value)}
        placeholder="Search clients"
        autoComplete="off"
        className="h-10 w-full rounded-full border border-rule bg-white pr-4 pl-10 font-body text-[13px] text-ink transition-colors outline-none placeholder:text-faint focus:border-lead-mid"
      />
    </form>
  );
}

export default ClientSearch;
