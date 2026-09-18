"use client";

import Link from "next/link";
import { useState } from "react";
import { motion, useReducedMotionConfig } from "motion/react";
import { ArrowRight, ChevronDown, Search } from "lucide-react";
import { EASE } from "@/components/brand/motion";
import { LIP, SEARCH_GLASS_FROSTED_LIGHT, SEARCH_GLASS_LIGHT } from "@/components/brand/tokens";
import { SectionCard } from "./section-card";
import {
  getSimilarClientsPreviewAction,
  type SimilarPreviewResult,
} from "./actions";

/**
 * F216 — the Search-by-Similarity entry point on the record. Offered on every
 * client, not just past successes: the comparison is pure data-rules
 * agreement on the reference's known dimensions (sector, location, size,
 * grant history, outcome — the same states the priority score reads), so any
 * client with at least two known dimensions gets a shortlist, and a thinly
 * described one gets an honest message instead of a list it cannot back.
 *
 * The trigger wears the client-list search bar's light language (the frosted
 * pill, `components/brand/search-bar.tsx` `tone="light"`): a bespoke pill
 * rather than the component itself, which carries query/filter/AI machinery
 * this read-only expander has no use for. Tapping it drops the preview panel
 * below with the Motion reveal from `clients/new/disclosure-section.tsx`
 * (height 0 → auto, clip off once settled), listing the top few matches with
 * their agreement score and why, plus the way out to the full shortlist on
 * /clients. The preview loads on expand, so a record view pays for the
 * full-list read only when its reader asks.
 *
 * Read-only throughout — links and an expander, no writes — so viewers get
 * the same card as everyone else.
 */
export function SimilarClientsCard({ organisationId }: { organisationId: string }) {
  const reduceMotion = useReducedMotionConfig();
  const [open, setOpen] = useState(false);
  const [settled, setSettled] = useState(false);
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<SimilarPreviewResult | null>(null);
  const panelId = "similar-clients-panel";

  async function load() {
    setLoading(true);
    try {
      setPreview(await getSimilarClientsPreviewAction({ organisationId }));
    } finally {
      setLoading(false);
    }
  }

  function toggle() {
    const next = !open;
    setOpen(next);
    // First expansion does the paid read (the full visible-list query); later
    // ones reuse it. A failure stays retryable rather than cached.
    if (next && !preview && !loading) void load();
  }

  return (
    <SectionCard
      headingId="find-similar-heading"
      title="Find similar clients"
      hint="Ranked by shared sector, location, size, grant history and outcome — the same dimensions the priority score reads."
    >
      {/* The trigger: the search bar's frosted pill in miniature. */}
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={panelId}
        className="mt-3.5 flex h-12 w-full cursor-pointer items-center gap-3 rounded-full pr-1.5 pl-4 text-left ring-lead/25 backdrop-blur-[20px] transition-shadow focus-visible:ring-2 focus-visible:outline-none"
        style={{
          background: open ? SEARCH_GLASS_FROSTED_LIGHT : SEARCH_GLASS_LIGHT,
          boxShadow: `${LIP}, 0 1px 2px rgba(20, 26, 34, 0.08)`,
        }}
      >
        <Search aria-hidden="true" className="size-4 shrink-0 text-ink/60" />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">
          {open ? "Similar clients" : "Find clients like this one"}
        </span>
        <span
          aria-hidden="true"
          className="flex size-9 shrink-0 items-center justify-center rounded-full bg-ink text-white"
        >
          <ChevronDown
            className={`size-4 transition-transform duration-300 motion-reduce:transition-none ${
              open ? "rotate-180" : ""
            }`}
          />
        </span>
      </button>

      <motion.div
        id={panelId}
        animate={open ? { height: "auto", opacity: 1 } : { height: 0, opacity: 0 }}
        className={open && settled ? "overflow-visible" : "overflow-hidden"}
        onAnimationComplete={() => setSettled(open)}
        onAnimationStart={() => setSettled(false)}
        inert={!open}
        initial={false}
        transition={reduceMotion ? { duration: 0 } : { duration: 0.35, ease: EASE }}
      >
        <div className="pt-2 pb-1" aria-live="polite">
          {loading && !preview ? (
            <ul className="mt-2 space-y-3" aria-label="Finding similar clients">
              {[0, 1, 2].map((index) => (
                <li key={index} className="flex items-center gap-3 border-t border-rule-soft py-3">
                  <span className="h-4 w-24 animate-pulse rounded-inset bg-paper" />
                  <span className="h-4 flex-1 animate-pulse rounded-inset bg-paper" />
                  <span className="h-5 w-16 animate-pulse rounded-full bg-paper" />
                </li>
              ))}
            </ul>
          ) : preview?.status === "ok" ? (
            <div className="mt-2">
              <p className="text-[13px] leading-[1.55] text-dim">
                Ranked by {preview.basis.join(", ")} — the traits on record for this client.
              </p>
              <ul className="mt-1">
                {preview.matches.map((match, index) => (
                  <li
                    key={match.id}
                    className="flex items-start gap-3 border-t border-rule-soft py-3"
                  >
                    <span className="w-6 shrink-0 font-body text-[18px] leading-none font-light text-faint tabular-nums">
                      {index + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/clients/${match.id}`}
                        className="text-sm font-semibold text-lead hover:underline"
                      >
                        {match.name}
                      </Link>
                      <p className="mt-0.5 text-[13px] leading-[1.55] text-dim">
                        {match.reasons.join(", ")}.
                      </p>
                    </div>
                    <span className="shrink-0 rounded-full bg-paper px-2 py-0.5 text-[11px] font-semibold text-ink tabular-nums">
                      {match.percent}% similar
                    </span>
                  </li>
                ))}
              </ul>
              <Link
                href={`/clients?similar=${organisationId}`}
                className="mt-1 inline-flex items-center gap-1.5 rounded-inset px-2 py-1 text-[13px] font-semibold text-lead transition-colors hover:bg-lead-wash focus-visible:ring-2 focus-visible:ring-lead/30 focus-visible:outline-none"
              >
                {preview.capped
                  ? "View all similar clients"
                  : `View all ${preview.total} similar client${preview.total === 1 ? "" : "s"}`}
                <ArrowRight aria-hidden="true" className="size-3.5" />
              </Link>
            </div>
          ) : preview?.status === "insufficient" ? (
            <p className="mt-2 rounded-inset bg-paper px-3 py-2.5 text-[13px] leading-[1.55] text-dim">
              {preview.message}
            </p>
          ) : preview?.status === "error" ? (
            <div className="mt-2 rounded-inset bg-stop-wash px-3 py-2.5" role="alert">
              <p className="text-[13px] font-semibold text-stop">{preview.message}</p>
              <button
                type="button"
                onClick={() => void load()}
                className="mt-1.5 cursor-pointer rounded-inset px-2 py-0.5 text-[13px] font-semibold text-stop underline"
              >
                Try again
              </button>
            </div>
          ) : null}
        </div>
      </motion.div>
    </SectionCard>
  );
}
