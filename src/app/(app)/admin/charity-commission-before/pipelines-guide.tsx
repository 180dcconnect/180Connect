"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { BookOpen, ChevronDown } from "lucide-react";
import { EASE } from "@/components/brand/motion";

/**
 * How this screen works, and what changed.
 *
 * Same collapsed-by-default explainer as the Import Status page's
 * `IngestionGuide` — the family of admin pages should explain itself the same
 * way — but about the thing people will notice first: the criteria that used to
 * be fixed are gone, and there is now one register rather than two pipelines.
 */
export function PipelinesGuide() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="overflow-hidden rounded-2xl border border-black/[0.07] bg-white shadow-xs transition-all">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition-colors hover:bg-black/[0.015] sm:px-6"
      >
        <div className="flex items-center gap-3">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand/10 text-brand">
            <BookOpen className="h-4 w-4" strokeWidth={2.2} />
          </span>
          <div>
            <h2 className="text-sm font-bold text-foreground">How this works</h2>
            <p className="text-xs text-foreground/60">
              One staged register, filtered however you like. Nothing is excluded
              before you see it.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="hidden text-xs font-bold uppercase tracking-wider text-brand sm:inline">
            {isOpen ? "Hide" : "Read this"}
          </span>
          <motion.span
            animate={{ rotate: isOpen ? 180 : 0 }}
            transition={{ duration: 0.25, ease: EASE }}
            className="text-foreground/40"
          >
            <ChevronDown className="h-4 w-4" strokeWidth={2.2} />
          </motion.span>
        </div>
      </button>

      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            key="guide-content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.35, ease: EASE }}
            className="overflow-hidden border-t border-black/[0.06] bg-black/[0.01]"
          >
            <div className="space-y-4 p-5 sm:p-6">
              <div className="grid gap-4 sm:grid-cols-3">
                {[
                  {
                    step: "1. Stage",
                    body: "A job downloads the regulator's daily extract and writes every registered charity in England and Wales — around 172,000 of them — into a local table. No criteria are applied. It runs when someone runs it, or on a schedule.",
                  },
                  {
                    step: "2. Choose",
                    body: "Filter that table however you want: income range, any of the register's 17 causes, 7 beneficiary groups and 10 ways of working, any of its 174 local authorities, postcode areas, registration dates. The count updates as you go, so you always see what a change costs before you commit to it.",
                  },
                  {
                    step: "3. Import",
                    body: "The selection becomes clients, with their filed accounts attached. Charities already on the list are matched rather than duplicated, so re-running a saved filter set is safe.",
                  },
                ].map((item) => (
                  <div
                    key={item.step}
                    className="rounded-xl border border-black/[0.06] bg-white p-4 shadow-2xs"
                  >
                    <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/45">
                      {item.step}
                    </span>
                    <p className="mt-2 text-xs leading-[1.6] text-foreground/70">{item.body}</p>
                  </div>
                ))}
              </div>

              <div className="rounded-xl border border-black/[0.06] bg-white p-4">
                <h4 className="text-xs font-bold uppercase tracking-[0.1em] text-foreground/50">
                  What changed, and why
                </h4>
                <ul className="mt-2.5 space-y-2 text-xs leading-[1.6] text-foreground/70">
                  <li>
                    <strong className="font-bold text-foreground">
                      There is no minimum income any more.
                    </strong>{" "}
                    There used to be a £100,000 floor built into the code. Measured
                    against the register, it was hiding 3,229 of the 4,340 charities
                    local to the branch — including every charity that publishes no
                    income figure at all. Size is now a filter you set, and it starts
                    off.
                  </li>
                  <li>
                    <strong className="font-bold text-foreground">
                      Every cause is available.
                    </strong>{" "}
                    Five of the register&rsquo;s seventeen were previously accepted;
                    arts, heritage, environment, religion, sport and the rest could
                    not be imported at all. All seventeen are selectable, and
                    &ldquo;who the charity helps&rdquo; and &ldquo;how it
                    works&rdquo; are filterable for the first time.
                  </li>
                  <li>
                    <strong className="font-bold text-foreground">
                      Anywhere, not four places.
                    </strong>{" "}
                    Location was four hardcoded names — and one of them never
                    matched, because the register spells it &ldquo;Sheffield
                    City&rdquo; and the code looked for &ldquo;sheffield&rdquo;. That
                    alone hid 127 charities working in Sheffield. Every local
                    authority the register knows is now selectable.
                  </li>
                  <li>
                    <strong className="font-bold text-foreground">
                      Any date range, not just &ldquo;since last time&rdquo;.
                    </strong>{" "}
                    A separate weekly job used to fetch newly registered charities
                    and nothing else. The staged register already contains them, so
                    that job is retired: &ldquo;registered in the last month&rdquo;
                    is now one filter among many, and you can just as easily ask for
                    a period ten years ago.
                  </li>
                </ul>
              </div>

              <div className="rounded-xl border border-black/[0.06] bg-white p-4">
                <h4 className="text-xs font-bold uppercase tracking-[0.1em] text-foreground/50">
                  A note on empty Financials tabs
                </h4>
                <p className="mt-2 text-xs leading-[1.6] text-foreground/70">
                  A charity has twelve months to reach its first financial year end
                  and ten more to file, so a recently registered charity has no
                  accounts to show. That is the register being new, not an import
                  failing. If you want only charities with a track record, tick
                  &ldquo;only charities that have filed accounts&rdquo;.
                </p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
