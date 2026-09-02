"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { BookOpen, ChevronDown } from "lucide-react";
import { EASE } from "@/components/brand/motion";

/**
 * Why there are two Charity Commission imports, and which one to reach for.
 *
 * Same collapsed-by-default explainer as the Import Status page's
 * `IngestionGuide` — the family of admin pages should explain itself the same
 * way — but about the one thing that page cannot cover: the two pipelines here
 * ask opposite questions of the same register, and the difference decides
 * whether an imported charity arrives with accounts or without.
 *
 * The empty-Financials-tab question is the one this answers. It is asked
 * repeatedly, the answer is not a bug, and it lives in a code comment where
 * nobody who asks it will find it.
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
            <h2 className="text-sm font-bold text-foreground">
              Why there are two imports
            </h2>
            <p className="text-xs text-foreground/60">
              New registrations against established charities — and why one of
              them never has financial history.
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
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-xl border border-black/[0.06] bg-white p-4 shadow-2xs">
                  <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/45">
                    Weekly, automatic
                  </span>
                  <h3 className="mt-2 text-sm font-bold text-foreground">
                    New registrations
                  </h3>
                  <p className="mt-1.5 text-xs leading-[1.6] text-foreground/70">
                    Asks the register for charities registered since the last
                    run, and keeps the ones in the branch&rsquo;s postcode areas.
                    It is the only way a charity registered last month reaches
                    the list at all.
                  </p>
                  <p className="mt-2 text-xs leading-[1.6] text-foreground/50">
                    These charities have <strong className="font-bold">no filed accounts</strong>. A
                    charity has twelve months to reach its first financial year
                    end and ten more to file, so for nearly two years there is
                    nothing to fetch. An empty Financials tab on one of these is
                    the register being new, not the pipeline being broken.
                  </p>
                </div>

                <div className="rounded-xl border border-black/[0.06] bg-white p-4 shadow-2xs">
                  <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/45">
                    Run by hand, occasionally
                  </span>
                  <h3 className="mt-2 text-sm font-bold text-foreground">
                    Established charities
                  </h3>
                  <p className="mt-1.5 text-xs leading-[1.6] text-foreground/70">
                    Reads the regulator&rsquo;s daily extract of the whole
                    register — every charity already on it, with its annual
                    return history in the same download — and keeps the ones
                    matching the criteria on this page.
                  </p>
                  <p className="mt-2 text-xs leading-[1.6] text-foreground/50">
                    These arrive with <strong className="font-bold">up to five years of accounts</strong>,
                    already classified into a sector by the regulator. This is
                    the import that fills the Financials tab.
                  </p>
                </div>
              </div>

              <div className="rounded-xl border border-black/[0.06] bg-white p-4">
                <h4 className="text-xs font-bold uppercase tracking-[0.1em] text-foreground/50">
                  Which one do I want?
                </h4>
                <ul className="mt-2.5 space-y-2 text-xs leading-[1.6] text-foreground/70">
                  <li>
                    <strong className="font-bold text-foreground">
                      Nothing, most of the time.
                    </strong>{" "}
                    New registrations are picked up weekly without anyone
                    clicking anything.
                  </li>
                  <li>
                    <strong className="font-bold text-foreground">
                      The bulk import
                    </strong>{" "}
                    when the criteria change — a new postcode area, a different
                    income floor — or when the list needs charities with a track
                    record rather than charities that exist.
                  </li>
                  <li>
                    <strong className="font-bold text-foreground">
                      The single lookup
                    </strong>{" "}
                    when someone names one specific charity and you have its
                    registration number.
                  </li>
                </ul>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
