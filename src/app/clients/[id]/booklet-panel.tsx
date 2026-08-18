"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Sparkles } from "lucide-react";
import { parseBookletSections } from "@/lib/booklet/parse-sections";
import {
  BOOKLET_GENERATED_EVENT,
  type BookletGeneratedDetail,
} from "@/lib/booklet/browser-event";

/**
 * F082 — Generate Client Booklet. A one-shot user-triggered action, not the
 * realtime-subscription shape basic-info-panel.tsx uses: nothing else can change a
 * booklet mid-view, since nothing is saved yet (F085 deferred — every click here
 * re-generates from Gemini, nothing is read back from or written to the client
 * record). Same fetch/busy/error shape as discrepancies-panel.tsx.
 *
 * Styled as the flagship AI feature it is (per Bashir's issue: "Important AI
 * feature") rather than another plain bordered section — brand-tinted card,
 * larger type, and a prominent CTA — and placed right after BasicInfoPanel
 * (page.tsx) rather than buried near the bottom, since a CAM reads this before
 * the raw fields below it, not after.
 *
 * Real generations against Gemini ran ~1-20s during testing — long enough that a
 * static "Generating…" line reads as stalled. BookletLoadingState cycles through
 * short status lines instead, same crossfade technique components/brand/search-bar.tsx
 * already uses for its placeholder text, and respects prefers-reduced-motion the
 * way spectrumui/password-strength.tsx does.
 *
 * The rendered booklet is not raw text: parseBookletSections (parse-sections.ts)
 * turns the "Label:" lines the system prompt asks Gemini for into real headings,
 * and dash-bulleted blocks into a real list — see that file for why this only
 * works because the prompt dictates that exact format.
 */

const STATUS_MESSAGES = [
  "Reading client profile…",
  "Checking mission & sector…",
  "Drafting outreach angles…",
  "Polishing the summary…",
];

function BookletLoadingState() {
  const reducedMotion = useReducedMotion();
  const [messageIndex, setMessageIndex] = useState(0);

  useEffect(() => {
    if (reducedMotion) return;
    const interval = setInterval(() => {
      setMessageIndex((current) => (current + 1) % STATUS_MESSAGES.length);
    }, 3200);
    return () => clearInterval(interval);
  }, [reducedMotion]);

  return (
    <div aria-live="polite" className="mt-5 flex items-center gap-3">
      <div aria-hidden="true" className="flex gap-1.5">
        {[0, 1, 2].map((dot) => (
          <motion.span
            animate={reducedMotion ? undefined : { opacity: [0.25, 1, 0.25], y: [0, -4, 0] }}
            className="h-2 w-2 rounded-full bg-brand"
            key={dot}
            transition={{ duration: 1, repeat: Infinity, delay: dot * 0.15, ease: "easeInOut" }}
          />
        ))}
      </div>
      {reducedMotion ? (
        <p className="text-sm font-medium text-foreground/70">
          Generating booklet — this can take several seconds…
        </p>
      ) : (
        <AnimatePresence mode="wait">
          <motion.p
            animate={{ opacity: 1, y: 0 }}
            className="text-sm font-medium text-foreground/70"
            exit={{ opacity: 0, y: -4 }}
            initial={{ opacity: 0, y: 4 }}
            key={messageIndex}
            transition={{ duration: 0.35 }}
          >
            {STATUS_MESSAGES[messageIndex]}
          </motion.p>
        </AnimatePresence>
      )}
    </div>
  );
}

function BookletContent({ booklet }: { booklet: string }) {
  const blocks = parseBookletSections(booklet);
  return (
    <div className="mt-5 space-y-2.5">
      {blocks.map((block, index) => {
        if (block.type === "heading") {
          return (
            <h3
              className={`text-xs font-bold uppercase tracking-[0.08em] text-brand-hover ${index === 0 ? "" : "pt-2"}`}
              key={index}
            >
              {block.text}
            </h3>
          );
        }
        if (block.type === "list") {
          return (
            <ul className="list-disc space-y-1 pl-5 text-[15px] leading-relaxed text-foreground/85" key={index}>
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>{item}</li>
              ))}
            </ul>
          );
        }
        return (
          <p className="text-[15px] leading-relaxed text-foreground/85" key={index}>
            {block.text}
          </p>
        );
      })}
    </div>
  );
}

export function BookletPanel({ organisationId }: { organisationId: string }) {
  const [booklet, setBooklet] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const sectionRef = useRef<HTMLElement>(null);
  const autoTriggered = useRef(false);

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/clients/${organisationId}/booklet`, {
        method: "POST",
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error ?? "The booklet could not be generated. Try again.");
        return;
      }
      const generatedBooklet = body.booklet as string;
      setBooklet(generatedBooklet);
      window.dispatchEvent(new CustomEvent<BookletGeneratedDetail>(BOOKLET_GENERATED_EVENT, {
        detail: { organisationId, booklet: generatedBooklet },
      }));
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  // The /clients list page's quick-action button (page.tsx) links here with
  // ?booklet=generate so the CAM lands already generating, not on a page where
  // they have to find and click the button a second time. Read straight off
  // window rather than useSearchParams, same reasoning as search-bar.tsx and
  // sort-menu.tsx already give: this only runs once on arrival, where window is
  // always there, and useSearchParams would opt the whole detail page out of
  // static rendering for every other visitor who didn't come from that link.
  useEffect(() => {
    if (autoTriggered.current) return;
    if (!new URLSearchParams(window.location.search).has("booklet")) return;
    autoTriggered.current = true;

    // Strip the param immediately so a plain refresh doesn't silently re-bill
    // another generation — history.replaceState, not a Next navigation, so this
    // doesn't re-render or re-fetch anything on its own.
    const url = new URL(window.location.href);
    url.searchParams.delete("booklet");
    window.history.replaceState(null, "", url);

    sectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    // Syncing from an external system (the URL the CAM arrived with) on mount,
    // same legitimate case as sidebar.tsx's localStorage read; the ref guard
    // above already prevents this from running more than once.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void generate();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fires once on arrival only, see comment above.
  }, []);

  return (
    <section
      aria-labelledby="booklet-heading"
      className="mt-6 overflow-hidden rounded-2xl border border-brand/20 bg-gradient-to-br from-brand/[0.07] via-white to-white p-6 shadow-sm"
      ref={sectionRef}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand/15 text-brand-hover">
            <Sparkles aria-hidden="true" className="h-4 w-4" />
          </span>
          <div>
            <h2 className="text-lg font-bold" id="booklet-heading">Client booklet</h2>
            <p className="text-xs text-foreground/55">
              AI-generated research summary, for outreach preparation
            </p>
          </div>
        </div>

        {(booklet || error) && !busy && (
          <button
            className="shrink-0 rounded-full border border-brand/30 px-4 py-2 text-xs font-bold text-brand transition-colors hover:bg-brand/10"
            onClick={generate}
            type="button"
          >
            Regenerate
          </button>
        )}
      </div>

      {!booklet && !busy && !error && (
        <div className="mt-6 flex flex-col items-center gap-3 rounded-xl border border-dashed border-brand/25 bg-white/60 px-6 py-8 text-center">
          <p className="max-w-sm text-sm text-foreground/65">
            Generate a quick summary of this charity&rsquo;s mission and profile
            data, with suggested angles for outreach.
          </p>
          <button
            className="flex items-center gap-2 rounded-full bg-brand px-5 py-2.5 text-sm font-bold text-white shadow-sm transition-transform hover:scale-[1.02] active:scale-[0.98]"
            onClick={generate}
            type="button"
          >
            <Sparkles aria-hidden="true" className="h-4 w-4" />
            Generate booklet
          </button>
        </div>
      )}

      {busy && <BookletLoadingState />}

      {error && !busy && (
        <div className="mt-5 rounded-lg bg-red-50 p-3" role="alert">
          <p className="text-sm font-bold text-red-800">{error}</p>
          <button
            className="mt-2 rounded-lg border border-red-800/20 px-3 py-1 text-xs font-bold text-red-800"
            onClick={generate}
            type="button"
          >
            Try again
          </button>
        </div>
      )}

      {booklet && !busy && !error && (
        <p className="mt-1 text-xs text-foreground/45">
          Not saved yet — regenerating replaces it.
        </p>
      )}
      {booklet && !busy && !error && <BookletContent booklet={booklet} />}
    </section>
  );
}
