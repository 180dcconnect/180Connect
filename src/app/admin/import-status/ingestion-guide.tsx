"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  BookOpen,
  CheckCircle2,
  ChevronDown,
  Layers,
  Search,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { EASE } from "@/components/brand/motion";

export function IngestionGuide() {
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
              How Organisation Imports Work
            </h2>
            <p className="text-xs text-foreground/60">
              Understand how 180Connect finds, checks, and adds organisations to your CRM.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-brand uppercase tracking-wider hidden sm:inline">
            {isOpen ? "Hide Guide" : "View Explainer"}
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
            <div className="space-y-6 p-5 sm:p-6">
              {/* 4 Steps Grid */}
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {/* Step 1 */}
                <div className="rounded-xl border border-black/[0.06] bg-white p-4 shadow-2xs">
                  <div className="flex items-center gap-2 text-brand">
                    <Search className="h-4 w-4" strokeWidth={2.2} />
                    <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/45">
                      Step 1
                    </span>
                  </div>
                  <h3 className="mt-2 text-sm font-bold text-foreground">
                    1. Official Register Search
                  </h3>
                  <p className="mt-1 text-xs leading-[1.6] text-foreground/70">
                    The system scans official UK registers (Companies House, Charity Commission, 360Giving) to find active organisations.
                  </p>
                </div>

                {/* Step 2 */}
                <div className="rounded-xl border border-black/[0.06] bg-white p-4 shadow-2xs">
                  <div className="flex items-center gap-2 text-brand">
                    <ShieldCheck className="h-4 w-4" strokeWidth={2.2} />
                    <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/45">
                      Step 2
                    </span>
                  </div>
                  <h3 className="mt-2 text-sm font-bold text-foreground">
                    2. Privacy &amp; Compliance
                  </h3>
                  <p className="mt-1 text-xs leading-[1.6] text-foreground/70">
                    Personal contact details (private phone numbers or home addresses) are automatically removed before saving to protect privacy.
                  </p>
                </div>

                {/* Step 3 */}
                <div className="rounded-xl border border-black/[0.06] bg-white p-4 shadow-2xs">
                  <div className="flex items-center gap-2 text-brand">
                    <CheckCircle2 className="h-4 w-4" strokeWidth={2.2} />
                    <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/45">
                      Step 3
                    </span>
                  </div>
                  <h3 className="mt-2 text-sm font-bold text-foreground">
                    3. Smart Deduplication
                  </h3>
                  <p className="mt-1 text-xs leading-[1.6] text-foreground/70">
                    We compare each record with your database. If an organisation is already completely up to date, it is <strong className="text-foreground font-bold">Skipped</strong> so you get zero duplicates.
                  </p>
                </div>

                {/* Step 4 */}
                <div className="rounded-xl border border-black/[0.06] bg-white p-4 shadow-2xs">
                  <div className="flex items-center gap-2 text-brand">
                    <Sparkles className="h-4 w-4" strokeWidth={2.2} />
                    <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/45">
                      Step 4
                    </span>
                  </div>
                  <h3 className="mt-2 text-sm font-bold text-foreground">
                    4. Profile Creation
                  </h3>
                  <p className="mt-1 text-xs leading-[1.6] text-foreground/70">
                    New organisations are <strong className="text-foreground font-bold">Added</strong> as active client profiles, verified against live websites, and ready for your team.
                  </p>
                </div>
              </div>

              {/* Metric Breakdown Table */}
              <div className="rounded-xl border border-black/[0.06] bg-white p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Layers className="h-4 w-4 text-foreground/50" />
                  <h4 className="text-xs font-bold uppercase tracking-[0.1em] text-foreground/50">
                    Import Status Overview
                  </h4>
                </div>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5 text-xs">
                  <div className="rounded-lg bg-black/[0.02] p-2.5">
                    <span className="font-bold text-foreground">Fetched</span>
                    <p className="mt-1 text-foreground/65 leading-[1.5]">
                      Total organisations found in the register during this sync.
                    </p>
                  </div>
                  <div className="rounded-lg bg-green-50/60 p-2.5">
                    <span className="font-bold text-green-900">Added</span>
                    <p className="mt-1 text-green-900/75 leading-[1.5]">
                      New client profiles created in 180Connect or refreshed with updates.
                    </p>
                  </div>
                  <div className="rounded-lg bg-black/[0.02] p-2.5">
                    <span className="font-bold text-foreground">Skipped</span>
                    <p className="mt-1 text-foreground/65 leading-[1.5]">
                      Organisations already up to date in 180Connect with no new changes.
                    </p>
                  </div>
                  <div className="rounded-lg bg-red-50/60 p-2.5">
                    <span className="font-bold text-red-900">Failed</span>
                    <p className="mt-1 text-red-900/75 leading-[1.5]">
                      Entries that could not be imported (e.g. missing registration numbers).
                    </p>
                  </div>
                  <div className="rounded-lg bg-amber-50/60 p-2.5">
                    <span className="font-bold text-amber-900">Flagged</span>
                    <p className="mt-1 text-amber-900/75 leading-[1.5]">
                      Organisations where status changed on the register (e.g. dissolved).
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
