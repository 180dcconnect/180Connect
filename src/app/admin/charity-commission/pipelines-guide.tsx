"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { ChevronDown } from "lucide-react";
import { EASE } from "@/components/brand/motion";

/**
 * How this screen works — for someone reading it once.
 *
 * Two things were cut from the earlier version of this.
 *
 * The first was a four-item list headed "What changed, and why", explaining
 * that the £100k income floor was removed, that five of seventeen causes used
 * to be accepted, and that the location filter never matched Sheffield. All of
 * it true and none of it a CAM's problem: it is the case for a change that has
 * already happened, which is a pull request description, and it lives in
 * docs/charity-import-guide.md where the audit trail belongs.
 *
 * The second was the framing of the register as a staged file that costs the
 * database nothing. The people using this screen do not run the database.
 *
 * What is left is the three steps and the one genuine surprise — a charity with
 * an empty Financials tab is not a failed import — and it stays collapsed and
 * at the bottom, because a page that has to explain itself before you can use
 * it is the thing to fix, not to caption.
 */
export function PipelinesGuide() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="overflow-hidden rounded-2xl border border-black/[0.07] bg-white/60 transition-colors">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        className="flex w-full items-center justify-between gap-4 px-5 py-3 text-left transition-colors hover:bg-black/[0.015] sm:px-6"
      >
        <span className="text-sm font-bold text-foreground/70">
          How importing works
        </span>
        <motion.span
          animate={{ rotate: isOpen ? 180 : 0 }}
          transition={{ duration: 0.25, ease: EASE }}
          className="text-foreground/35"
        >
          <ChevronDown className="h-4 w-4" strokeWidth={2.2} />
        </motion.span>
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
                    step: "1. The register",
                    body: "We keep a register file in the codebase containing every charity registered in England and Wales — around 172,000 of them. Every charity is registered in this file, but they are not in our database yet. The Refresh button at the top keeps this file up to date with the regulator's latest data.",
                  },
                  {
                    step: "2. New import & filter",
                    body: "Clicking “New import” gives you access to all those registered charities. You can filter by income, 17 causes, who they help, 174 local authorities, or registration dates, with a live count updating as you go.",
                  },
                  {
                    step: "3. Add to database",
                    body: "Running the import adds your chosen charities from the register directly into our database as active clients, complete with their filed accounts. Charities already on the list are matched rather than duplicated, so re-running is safe.",
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

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-xl border border-black/[0.06] bg-white p-4">
                  <h4 className="text-xs font-bold uppercase tracking-[0.1em] text-foreground/50">
                    Why not store all 172,000 charities in our database immediately?
                  </h4>
                  <p className="mt-2 text-xs leading-[1.6] text-foreground/70">
                    Our database service provides a <strong>500 MB free quota</strong>. Each imported charity uses approximately 10 KB once profile details, multi-year filed accounts, and search indexes are recorded. Storing all 172,000 organisations would take <strong>over 1.7 GB</strong> — blowing past our limit by more than 3x and incurring expensive hosting bills.
                  </p>
                  <p className="mt-2 text-xs leading-[1.6] text-foreground/70">
                    Targeted regional imports (such as 1,000–3,400 local charities) only take ~10–34 MB and fit comfortably within our plan. However, any import exceeding <strong>7,000 charities (&gt;70 MB)</strong> or leaving filters completely open requires typed confirmation to protect our database capacity.
                  </p>
                </div>

                <div className="rounded-xl border border-black/[0.06] bg-white p-4">
                  <h4 className="text-xs font-bold uppercase tracking-[0.1em] text-foreground/50">
                    Why some imported charities have an empty Financials tab
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
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
