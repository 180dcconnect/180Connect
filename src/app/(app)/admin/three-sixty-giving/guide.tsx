"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { ChevronDown } from "lucide-react";
import { EASE } from "@/components/brand/motion";

/**
 * How this screen works — for someone reading it once.
 *
 * Mirrors the Charity Commission page's "How importing works" guide: three
 * steps plus the genuine surprises, collapsed at the bottom. A CAM's questions
 * here are "does this cover my non-charity clients?" and "does no grants mean
 * something broke?" — both answered below.
 */
export function GrantsGuide() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="overflow-hidden rounded-panel border border-rule bg-white transition-colors">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        className="flex w-full cursor-pointer items-center justify-between gap-4 px-5 py-3 text-left transition-colors hover:bg-paper sm:px-6"
      >
        <span className="text-sm font-bold text-dim">How grant history works</span>
        <motion.span
          animate={{ rotate: isOpen ? 180 : 0 }}
          transition={{ duration: 0.25, ease: EASE }}
          className="text-faint"
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
            className="overflow-hidden border-t border-rule-soft bg-paper"
          >
            <div className="space-y-4 p-5 sm:p-6">
              <div className="grid gap-4 sm:grid-cols-3">
                {[
                  {
                    step: "1. Your client list",
                    body: "We go through the clients already in the pipeline. Nothing new is added here — this page only looks up history for clients you have.",
                  },
                  {
                    step: "2. Automatic checks",
                    body: (
                      <>
                        The system looks up 200 clients every 15 minutes in{" "}
                        <a
                          href="https://360giving.org"
                          target="_blank"
                          rel="noreferrer"
                          className="font-semibold text-lead hover:underline"
                        >
                          360Giving
                        </a>
                        , an open register of UK grants published by funders.
                        The button above checks the next few right now instead
                        of waiting.
                      </>
                    ),
                  },
                  {
                    step: "3. Grants on the record",
                    body: "Any grants found are saved to that client's record, where they help you spot experienced fundraisers when choosing partners.",
                  },
                ].map((item) => (
                  <div
                    key={item.step}
                    className="rounded-inset border border-rule-soft bg-white p-4"
                  >
                    <span className="text-[13px] font-semibold text-ink">{item.step}</span>
                    <p className="mt-2 text-xs leading-[1.6] text-dim">{item.body}</p>
                  </div>
                ))}
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-inset border border-rule-soft bg-white p-4">
                  <h4 className="text-[13px] font-semibold text-ink">
                    Does this cover all clients, or only charities?
                  </h4>
                  <p className="mt-2 text-xs leading-[1.6] text-dim">
                    Both. Registered charities are looked up by charity number
                    and registered companies by company number. Clients with
                    neither number — for example individuals or informal groups
                    — can&apos;t be looked up, so they are marked as checked and
                    skipped. A charity that is also a registered company is
                    looked up twice, once by each number, so the checked count
                    can run slightly ahead of the client count. Clients marked
                    do-not-contact are left out entirely — they sit outside the
                    outreach pool, so the system doesn&apos;t spend checks on
                    them.
                  </p>
                  <p className="mt-2 text-xs leading-[1.6] text-dim">
                    A client with no grants listed usually just never received a
                    published grant. Most organisations haven&apos;t — that is
                    the database having nothing, not the check failing.
                  </p>
                </div>

                <div className="rounded-inset border border-rule-soft bg-white p-4">
                  <h4 className="text-[13px] font-semibold text-ink">
                    How often is each client re-checked?
                  </h4>
                  <p className="mt-2 text-xs leading-[1.6] text-dim">
                    Each answer stays good for 90 days, then the client is
                    checked again to catch newly published awards. Grants are
                    historical once published, so this is about catching new
                    awards rather than corrections.
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
