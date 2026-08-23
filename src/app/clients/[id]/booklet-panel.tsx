"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ExternalLink, Sparkles } from "lucide-react";
import { parseBookletSections } from "@/lib/booklet/parse-sections";

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

// Matches bare URLs Gemini may emit (the prompt says "plain text only").
// Trailing punctuation like "." or ")" is stripped so "https://example.org." links correctly.
const BOOKLET_URL_RE = /(https?:\/\/[^\s]+)/g;

function LinkifiedText({ text }: { text: string }) {
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  const re = new RegExp(BOOKLET_URL_RE.source, "g");
  while ((match = re.exec(text)) !== null) {
    const raw = match[0];
    // Peel off trailing punctuation that is sentence punctuation, not part of the URL.
    const trimmed = raw.replace(/[.,;:)!?]+$/, "");
    const trailing = raw.slice(trimmed.length);
    const start = match.index;
    if (start > lastIndex) parts.push(text.slice(lastIndex, start));
    parts.push(
      <a
        key={`${start}-${trimmed}`}
        aria-label={`Tap to open ${trimmed} in new tab`}
        className="group inline-flex items-center gap-1 break-all text-brand-hover underline decoration-1 underline-offset-2 hover:text-brand"
        href={trimmed}
        rel="noreferrer"
        target="_blank"
        title="Tap to open in new tab"
      >
        <span>{trimmed}</span>
        <ExternalLink
          aria-hidden="true"
          className="h-3 w-3 shrink-0 opacity-60 transition-opacity group-hover:opacity-100"
        />
      </a>,
    );
    if (trailing) parts.push(trailing);
    lastIndex = start + raw.length;
  }
  if (parts.length === 0) return <>{text}</>;
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return <>{parts}</>;
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
                <li key={itemIndex}>
                  <LinkifiedText text={item} />
                </li>
              ))}
            </ul>
          );
        }
        return (
          <p className="text-[15px] leading-relaxed text-foreground/85" key={index}>
            <LinkifiedText text={block.text} />
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
  // Ref, not the busy state: two clicks inside one render window both read
  // stale state, and each fires a paid Gemini call. The ref is checked before
  // either can get past this guard. Aborted on unmount so a navigation away
  // mid-generation doesn't leave setState calls running on a dead component.
  const inFlight = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      inFlight.current = false;
    };
  }, []);

  async function generate() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const response = await fetch(`/api/clients/${organisationId}/booklet`, {
        method: "POST",
        signal: controller.signal,
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error ?? "The booklet could not be generated. Try again.");
        return;
      }
      setBooklet(body.booklet as string);
    } catch {
      if (controller.signal.aborted) return;
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      if (!controller.signal.aborted) {
        inFlight.current = false;
        setBusy(false);
      }
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
