"use client";

import Link from "next/link";
import { useState } from "react";
import { AnimatePresence, motion, useReducedMotionConfig, type Variants } from "motion/react";
import { ArrowRight } from "lucide-react";
import { EASE, stagger } from "@/components/brand/motion";
import {
  LIP,
  SEARCH_GLASS_LIGHT,
  SEARCH_GLASS_OPEN_LIGHT,
} from "@/components/brand/tokens";
import { SectionCard } from "./section-card";
import {
  getSimilarClientsPreviewAction,
  type SimilarPreviewResult,
} from "./actions";

/** Match the Inbox search's 64px row and 32px capsule exactly. */
const ROW = 64;

const PANEL_STAGGER = stagger(0.05, 0.14);

/** Inbox glass rows rise without blur so the glass surface stays crisp. */
const GLASS_ITEM: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { duration: 0.3, ease: EASE } },
};

/**
 * Similarity is agreement across two to five known dimensions, so the useful
 * bands follow the scores that can actually occur (20-point steps when all
 * five are known). Colour accelerates the scan; the exact number and dot keep
 * the meaning available without relying on colour alone.
 */
function SimilarityBadge({ percent }: { percent: number }) {
  const band =
    percent >= 80
      ? { label: "High match", className: "bg-go-wash text-go" }
      : percent >= 60
        ? { label: "Moderate match", className: "bg-hold-wash text-hold" }
        : { label: "Lower match", className: "bg-stop-wash text-stop" };

  return (
    <span
      aria-label={`${percent}% similar — ${band.label}`}
      title={band.label}
      className={`mt-0.5 inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold tabular-nums ${band.className}`}
    >
      <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
      {percent}% similar
    </span>
  );
}

/**
 * F216 — the Search-by-Similarity entry point on the record. Offered on every
 * client, not just past successes: the comparison is pure data-rules
 * agreement on the reference's known dimensions (sector, location, size,
 * grant history, outcome — the same states the priority score reads), so any
 * client with at least two known dimensions gets a shortlist, and a thinly
 * described one gets an honest message instead of a list it cannot back.
 *
 * This is an Inbox-search-shaped control adapted to one action. It deliberately
 * shares that component's 64px rounded glass capsule, Lato prompt treatment,
 * blue-to-white surface morph, rolling-square working state and staggered
 * panel reveal. It stays bespoke because there is no query or filter state to
 * justify mounting BrandSearchBar's much larger interaction model.
 *
 * Read-only throughout — links and an expander, no writes — so viewers get
 * the same card as everyone else.
 */
export function SimilarClientsCard({ organisationId }: { organisationId: string }) {
  const reduceMotion = useReducedMotionConfig();
  const [open, setOpen] = useState(false);
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
      <motion.div
        className="relative mt-3.5 w-full overflow-hidden backdrop-blur-[3px]"
        style={{
          boxShadow: LIP,
          borderRadius: ROW / 2,
        }}
        animate={{
          height: open ? "auto" : ROW,
          backgroundColor: open ? SEARCH_GLASS_OPEN_LIGHT : SEARCH_GLASS_LIGHT,
        }}
        initial={false}
        transition={
          reduceMotion
            ? { duration: 0 }
            : {
                height: { duration: 0.7, ease: EASE },
                backgroundColor: { duration: 0.7, ease: EASE },
              }
        }
        onKeyDown={(event) => {
          if (event.key === "Escape" && open) {
            event.stopPropagation();
            setOpen(false);
          }
        }}
      >
        {/* The blur sits on a childless layer, matching BrandSearchBar's glass
            construction and avoiding content affecting backdrop sampling. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-0 rounded-[inherit] backdrop-blur-[3px]"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-30 rounded-[inherit] ring-1 ring-transparent ring-inset"
        />

        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
          aria-busy={loading}
          className="relative z-20 flex w-full cursor-pointer items-center pr-3 pl-7 text-left focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-lime-600"
          style={{ height: ROW }}
        >
          <span className="relative mr-3 min-w-0 flex-1 overflow-hidden">
            <AnimatePresence initial={false} mode="wait">
              <motion.span
                key={loading ? "loading" : open ? "open" : "closed"}
                className="font-body flex items-center text-[15px] whitespace-nowrap text-slate-900 sm:text-base"
                initial={
                  reduceMotion
                    ? false
                    : { opacity: 0, y: 10, filter: "blur(6px)" }
                }
                animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                exit={
                  reduceMotion
                    ? { opacity: 0 }
                    : { opacity: 0, y: -10, filter: "blur(6px)" }
                }
                transition={reduceMotion ? { duration: 0 } : { duration: 0.45, ease: EASE }}
              >
                {loading ? (
                  <span className="text-slate-500">Finding similar clients…</span>
                ) : open ? (
                  "Similar clients"
                ) : (
                  <>
                    <span className="text-slate-500">Find&nbsp;</span>
                    similar clients
                  </>
                )}
              </motion.span>
            </AnimatePresence>
          </span>
          <span
            aria-hidden="true"
            className={`grid size-8 shrink-0 place-items-center rounded-full transition-all ${
              loading ? "bg-transparent" : "bg-lead text-white hover:bg-lead-mid"
            }`}
          >
            {loading ? (
              <span
                className="size-4.5 animate-spin rounded-[4px] bg-lead shadow-[0_0_10px_var(--lead)]"
                style={{ animationDuration: "2.5s" }}
              />
            ) : (
              <ArrowRight className="size-4" />
            )}
          </span>
        </button>

        <AnimatePresence initial={false}>
          {open && (
            <motion.div
              key="panel"
              id={panelId}
              className="relative z-10 px-4 pb-4"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, transition: { duration: 0.18, ease: EASE } }}
              transition={
                reduceMotion
                  ? { duration: 0 }
                  : { duration: 0.5, ease: EASE, delay: 0.2 }
              }
              aria-live="polite"
            >
              {loading && !preview ? (
                <motion.ul
                  className="flex flex-col gap-1"
                  aria-label="Finding similar clients"
                  variants={PANEL_STAGGER}
                  initial="hidden"
                  animate="show"
                >
                  {[0, 1, 2].map((index) => (
                    <motion.li
                      key={index}
                      variants={GLASS_ITEM}
                      className="flex items-center gap-3 rounded-2xl px-3 py-3"
                    >
                      <span className="h-4 w-6 animate-pulse rounded bg-slate-900/5" />
                      <span className="h-4 flex-1 animate-pulse rounded bg-slate-900/5" />
                      <span className="h-5 w-16 animate-pulse rounded-full bg-slate-900/5" />
                    </motion.li>
                  ))}
                </motion.ul>
              ) : preview?.status === "ok" ? (
                <motion.div
                  variants={PANEL_STAGGER}
                  initial="hidden"
                  animate="show"
                >
                  <motion.p
                    variants={GLASS_ITEM}
                    className="px-3 pb-2.5 text-[13px] leading-[1.55] text-slate-500"
                  >
                    Ranked by {preview.basis.join(", ")} — the traits on record for this client.
                  </motion.p>
                  <motion.ul className="flex flex-col gap-1" variants={PANEL_STAGGER}>
                    {preview.matches.map((match, index) => (
                      <motion.li key={match.id} variants={GLASS_ITEM}>
                        <Link
                          href={`/clients/${match.id}`}
                          className="flex items-start gap-3 rounded-2xl px-3 py-3 transition-colors hover:bg-slate-900/5 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-lime-600"
                        >
                          <span className="w-5 shrink-0 pt-0.5 font-body text-[16px] leading-none font-light text-slate-400 tabular-nums">
                            {index + 1}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block font-body text-sm font-semibold text-slate-900">
                              {match.name}
                            </span>
                            <span className="mt-0.5 block text-[13px] leading-[1.55] text-slate-500">
                              {match.reasons.join(", ")}.
                            </span>
                          </span>
                          <SimilarityBadge percent={match.percent} />
                        </Link>
                      </motion.li>
                    ))}
                  </motion.ul>
                  <motion.div variants={GLASS_ITEM} className="mt-2 px-2">
                    <Link
                      href={`/clients?similar=${organisationId}`}
                      className="inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-[13px] font-semibold text-lead transition-colors hover:bg-slate-900/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lime-600"
                    >
                      {preview.capped
                        ? "View all similar clients"
                        : `View all ${preview.total} similar client${preview.total === 1 ? "" : "s"}`}
                      <ArrowRight aria-hidden="true" className="size-3.5" />
                    </Link>
                  </motion.div>
                </motion.div>
              ) : preview?.status === "insufficient" ? (
                <motion.p
                  variants={GLASS_ITEM}
                  initial="hidden"
                  animate="show"
                  className="rounded-2xl bg-slate-900/5 px-4 py-3 text-[13px] leading-[1.55] text-slate-600"
                >
                  {preview.message}
                </motion.p>
              ) : preview?.status === "error" ? (
                <motion.div
                  variants={GLASS_ITEM}
                  initial="hidden"
                  animate="show"
                  className="rounded-2xl bg-stop-wash px-4 py-3"
                  role="alert"
                >
                  <p className="text-[13px] font-semibold text-stop">{preview.message}</p>
                  <button
                    type="button"
                    onClick={() => void load()}
                    className="mt-1.5 cursor-pointer rounded-full px-2 py-1 text-[13px] font-semibold text-stop underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stop"
                  >
                    Try again
                  </button>
                </motion.div>
              ) : null}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </SectionCard>
  );
}
