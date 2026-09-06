"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Clock, ExternalLink, Globe, ShieldCheck, Sparkles } from "lucide-react";
import { DeleteButton } from "@/components/ui/delete-button";
import { GooeyEmailInput } from "@/components/ui/gooey-email-input";
import { AnimateIcon } from "@/components/animate-ui/icons/icon";
import { XIcon } from "@/components/animate-ui/icons/x";
import {
  MorphingDialog,
  MorphingDialogClose,
  MorphingDialogContainer,
  MorphingDialogContent,
  MorphingDialogDescription,
  MorphingDialogSubtitle,
  MorphingDialogTitle,
  MorphingDialogTrigger,
} from "@/components/core/morphing-dialog";
import { BrandSearchBar } from "@/components/brand/search-bar";
import { validateBookletWebsiteUrl } from "./outreach-actions";
import { deleteBookletVersion } from "./booklet-actions";
import { SectionCard } from "./section-card";
import { parseBookletSections } from "@/lib/booklet/parse-sections";
import { MAX_STEER_CHARS } from "@/lib/booklet/build-prompt";
import type { BookletSource } from "@/lib/booklet/sources";

/**
 * F082 — Generate Client Booklet. A one-shot user-triggered action, not the
 * realtime-subscription shape basic-info-panel.tsx uses: nothing else can change
 * a booklet mid-view. Same fetch/busy/error shape as discrepancies-panel.tsx.
 *
 * Saved versions (F085) arrive from the server as `savedBooklet`/`priorVersions`,
 * so an already-generated client renders on first paint with no fetch and no
 * Gemini cost; only an explicit Generate/Regenerate calls the route.
 *
 * Styled as the flagship AI feature it is (per Bashir's issue: "Important AI
 * feature") rather than another plain bordered section — brand-tinted card,
 * larger type, and a prominent CTA — and placed first on the Outreach tab
 * (outreach/page.tsx), since a CAM reads this before writing the email below it.
 *
 * Real generations against Gemini ran ~1-20s during testing — long enough that a
 * static "Generating…" line reads as stalled. AiLoadingState (shared with
 * ComposeButton) cycles through short status lines instead, same crossfade
 * technique components/brand/search-bar.tsx already uses for its placeholder
 * text, and respects prefers-reduced-motion the way spectrumui/password-strength.tsx
 * does.
 *
 * The rendered booklet is not raw text: parseBookletSections (parse-sections.ts)
 * turns the "Label:" lines the system prompt asks Gemini for into real headings,
 * and dash-bulleted blocks into a real list — see that file for why this only
 * works because the prompt dictates that exact format.
 *
 * F084 — Use Website URL in Booklet: the URL lives inside the composer's "Add
 * a website" row, for first generations and regenerations alike — the header's
 * Regenerate button reveals the composer rather than firing off the click.
 * The field always starts empty and clears after each successful run — never
 * seeded from the client's stored website or from the last version's URL. It
 * is an *extra* page to scrape for this run, and a prefilled one reads as a
 * setting already applied: the CAM either pays for a scrape they
 * never asked for or has to clear a box to decline it. The organisation's own
 * website still reaches the prompt as a plain field from the route's own read,
 * so nothing is lost by leaving this blank. Whatever's in the field at generate
 * time is what gets sent; the route re-validates it with F046's
 * validateWebsiteFormat and fetches it through F037's shared robots-aware,
 * SSRF-safe transport (scrape-website.ts) fresh on every click. The scrape
 * itself is never cached — only its outcome is, in the saved version's
 * `website_url`/`website_context_used`. Whether the site's content actually
 * made it in is reported back as a status line under the booklet.
 *
 * F086 — Regenerate Client Booklet: CLIENT_BOOKLETS is append-only now (see that
 * migration's F086 revision), so a regenerate is a new row, never an overwrite —
 * AC2 needs the prior version to stay retrievable, not just timestamped. `history`
 * holds every earlier version this component knows about (seeded from
 * `priorVersions`, then grown in place each time generate() succeeds by archiving
 * whatever was `currentVersion` before the call). Each history entry opens in a
 * MorphingDialog that shows that version's own text and sources on screen; the
 * main card always shows the current version, so Regenerate never sits next to
 * old content it could be mistaken for replacing.
 *
 * F087 — Booklet Source References: every version (fresh or historical) carries a
 * `sources` list (see sources.ts) rendered as a row of badges — profile data is
 * always shown (verified: it's this CRM's own records), a website is only shown
 * when it actually contributed (unverified: scraped external content). Applies to
 * whatever `displayed` currently is, so browsing history shows that version's own
 * sources, never the current version's.

 */

const STATUS_MESSAGES = [
  "Reading client profile…",
  "Checking mission & sector…",
  "Drafting outreach angles…",
  "Polishing the summary…",
];

/**
 * Floor for the generating spinner, in milliseconds. Real runs take ~1-20s,
 * but a fast one would otherwise flash the loading state for a beat and read
 * as a glitch rather than work done — so `generate()` holds `busy` to at
 * least this long, artificially when it has to. Only extends short runs; a
 * run that already took longer is unaffected.
 */
const MIN_GENERATION_SPIN_MS = 2500;

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
        className="group inline-flex items-center gap-1 break-all text-lead underline decoration-1 underline-offset-2 hover:text-lead-mid"
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

/**
 * F087 — AC2: verified (profile) and unverified (website) sources are visually
 * distinct by more than color alone — icon and wording both change, not just the
 * tone — so the distinction still reads for a CAM who can't rely on color.
 */
function SourceBadge({ source }: { source: BookletSource }) {
  if (source.type === "profile") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-lead-wash px-3 py-1 text-sm font-semibold text-lead">
        <ShieldCheck aria-hidden="true" className="h-3.5 w-3.5" />
        Client profile — verified
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-hold-wash px-3 py-1 text-sm font-semibold text-hold">
      <Globe aria-hidden="true" className="h-3.5 w-3.5" />
      Website: {source.hostname} — unverified
    </span>
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
              className={`text-xs font-semibold uppercase tracking-[0.08em] text-lead ${index === 0 ? "" : "pt-2"}`}
              key={index}
            >
              {block.text}
            </h3>
          );
        }
        if (block.type === "list") {
          return (
            <ul className="list-disc space-y-1 pl-5 text-[15px] leading-relaxed text-ink" key={index}>
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>
                  <LinkifiedText text={item} />
                </li>
              ))}
            </ul>
          );
        }
        return (
          <p className="text-[15px] leading-relaxed text-ink" key={index}>
            <LinkifiedText text={block.text} />
          </p>
        );
      })}
    </div>
  );
}

/**
 * F086 AC2: a prior version opened on screen. Each history row owns its dialog —
 * MorphingDialog keeps its open state internally under its own useId, so a list
 * of them needs no shared state. No image variant: booklets have no artwork, so
 * the trigger is the row itself and the panel opens onto the sticky title bar,
 * the same shape as the score method dialog in score-breakdown.tsx.
 */
function HistoryVersionDialog({ version }: { version: SavedBooklet }) {
  return (
    <MorphingDialog
      transition={{
        type: "spring",
        bounce: 0,
        duration: 0.5,
        borderRadius: { type: "tween", duration: 0.08 },
      }}
    >
      <MorphingDialogTrigger
        className="w-full rounded-inset px-3 py-2 text-left text-sm text-dim transition-colors hover:bg-paper"
        style={{ borderRadius: "6px" }}
      >
        Generated {formatGeneratedAt(version.generatedAt)}
      </MorphingDialogTrigger>
      <MorphingDialogContainer>
        <MorphingDialogContent
          className="pointer-events-auto relative flex max-h-[85vh] w-full flex-col overflow-y-auto border border-rule bg-white sm:w-[560px]"
          style={{ borderRadius: "16px" }}
        >
          {/* Sticky header: scrolling lives on the dialog content itself, so the
              title bar and close stay pinned while the version passes
              underneath — same treatment as score-breakdown.tsx. */}
          <div className="sticky top-0 z-20 rounded-t-[16px] border-b border-rule-soft bg-white/85 px-6 pt-5 pb-4 backdrop-blur-[4px] backdrop-saturate-150">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <MorphingDialogTitle>
                  <h2 className="text-[19px] leading-[1.3] font-semibold tracking-[-0.01em] text-ink">
                    Older booklet version
                  </h2>
                </MorphingDialogTitle>
                <MorphingDialogSubtitle>
                  <p className="mt-1 text-[13px] leading-[1.5] text-dim">
                    Generated {formatGeneratedAt(version.generatedAt)} — read-only.
                  </p>
                </MorphingDialogSubtitle>
              </div>
              <MorphingDialogClose className="static flex size-8 shrink-0 items-center justify-center rounded-full text-faint transition-colors hover:bg-paper hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lead-mid">
                <AnimateIcon
                  animateOnHover
                  animateOnTap
                  className="flex size-full items-center justify-center"
                >
                  <XIcon size={16} strokeWidth={1.75} aria-hidden="true" />
                </AnimateIcon>
              </MorphingDialogClose>
            </div>
          </div>

          <div className="px-6 pt-5 pb-7">
            <MorphingDialogDescription
              disableLayoutAnimation
              variants={{
                initial: { opacity: 0, scale: 0.985, y: 20 },
                animate: {
                  opacity: 1,
                  scale: 1,
                  y: 0,
                  transition: {
                    duration: 0.42,
                    delay: 0.08,
                    ease: [0.32, 0.72, 0, 1],
                  },
                },
                exit: {
                  opacity: 0,
                  scale: 0.985,
                  y: 20,
                  transition: { duration: 0.22, ease: [0.4, 0, 1, 1] },
                },
              }}
            >
              {version.sources.length > 0 && (
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  {version.sources.map((source) => (
                    <SourceBadge key={source.type} source={source} />
                  ))}
                </div>
              )}
              <BookletContent booklet={version.text} />
            </MorphingDialogDescription>
          </div>
        </MorphingDialogContent>
      </MorphingDialogContainer>
    </MorphingDialog>
  );
}

type WebsiteContextResult =
  | { status: "not_provided" }
  | { status: "used"; hostname: string }
  | { status: "skipped"; reason: string };

export type SavedBooklet = {
  id: string;
  text: string;
  websiteUrl: string | null;
  websiteContextUsed: boolean;
  generatedAt: string;
  sources: BookletSource[];
};

function formatGeneratedAt(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Best-effort label for a saved booklet's website context — no reason is stored for a skip. */
function initialWebsiteContext(saved: SavedBooklet): WebsiteContextResult | null {
  if (!saved.websiteContextUsed || !saved.websiteUrl) return null;
  try {
    return { status: "used", hostname: new URL(saved.websiteUrl).hostname };
  } catch {
    return null;
  }
}

/**
 * The generation composer: the brand search bar in prompt-button mode
 * (`components/brand/search-bar.tsx`), whose `frosted`, `promptButton` and
 * `panelRows` options exist for this placement — the prompt row triggers
 * options rather than taking a query, and the panel offers actions rather
 * than filters. Used for the first generation and, revealed by the header's
 * Regenerate button, for every regeneration after it.
 *
 * `frosted` on the light tone: the open panel is a lighter shade of the closed
 * pill (`SEARCH_GLASS_FROSTED_LIGHT`) rather than plain white, which read as a
 * hole in the card. The pill's top row keeps the full closed shade.
 *
 * The panel holds one row for now — "Add a website" — an inline URL field
 * rather than a navigation. More options (tone, length, audience) slot in as
 * further rows without touching the bar itself.
 *
 * Neither field's own arrow generates. Left with an `onSubmit` they each
 * became a second, unguarded Generate — one stray Enter in a text box and the
 * Gemini call was away. With none, GooeyEmailInput runs its own accept
 * gesture: a beat of loading, then a tick that means "this reads fine", the
 * same verdict the website field's live droplet gives. Generation has exactly
 * one door, the bar's arrow, and that one asks first.
 *
 * The field starts empty every time — see this file's header for why a
 * client's known website is not seeded into it. It validates through the same
 * F046 gate the route applies, so its tick can never promise what generation
 * would refuse.
 *
 * The outreach page wraps this card in `Rise glass` with a z-index: the
 * frosted panel can only blur the page behind it if no ancestor holds a
 * filter, and it has to paint over the card beneath.
 */
function BookletComposer({
  websiteUrl,
  onWebsiteUrlChange,
  steer,
  onSteerChange,
  error,
  openSignal,
  onGenerate,
  onRetry,
  confirmSignal,
  busy,
}: {
  busy: boolean;
  websiteUrl: string;
  onWebsiteUrlChange: (value: string) => void;
  steer: string;
  onSteerChange: (value: string) => void;
  /** Generation failure, reported as the panel's first row while open. */
  error: string | null;
  /** Bumped per failure so a closed panel opens onto the error row. */
  openSignal: number;
  onGenerate: () => void;
  /**
   * Clears the failure and hands the CAM back the step *before* the run — the
   * confirmation sheet, with Generate and Back still on it. A retry is a
   * decision to make again, not one already made: the website and focus fields
   * are one Back away, so a failure can be answered by editing rather than
   * only by firing the same paid call a second time.
   */
  onRetry: () => void;
  /** Bumped by onRetry so the bar reopens onto the confirmation sheet. */
  confirmSignal: number;
}) {
  // Live droplet check for the search bar's website field: the same F046
  // gate generate applies, so the tick can never promise what the route
  // would refuse. Stable identity so the droplet's debounce isn't reset by
  // unrelated re-renders.
  const checkWebsite = useCallback((candidate: string) => {
    return validateBookletWebsiteUrl({ websiteUrl: candidate }).then((result) =>
      result.ok ? null : result.message,
    );
  }, []);

  return (
    <div className="mt-6 flex flex-col items-start gap-3">
      <BrandSearchBar
        tone="light"
        frosted
        promptButton
        compactRest
        anchorLeft
        subjects={["this client", "their mission", "their work", "their website"]}
        openSignal={openSignal}
        confirmSignal={confirmSignal}
        // A failed run takes over the whole panel: the error reports alone,
        // and the website/focus rows return once Try again clears it.
        panelRows={
          error
            ? [
                {
                  label: "Generation failed",
                  alwaysExpanded: true,
                  expandedContent: (
                    <div
                      className="mx-3 mb-1 rounded-xl border border-stop/30 bg-stop-wash p-3"
                      role="alert"
                    >
                      <p className="text-sm font-semibold text-stop">{error}</p>
                      <button
                        type="button"
                        onClick={onRetry}
                        className="mt-2 rounded-full border border-stop/40 px-3 py-1 text-xs font-semibold text-stop transition-colors hover:bg-stop/10"
                      >
                        Try again
                      </button>
                    </div>
                  ),
                },
              ]
            : [
                {
                  label: "What should it focus on?",
                  alwaysExpanded: true,
                  // ~504px matches the widened capsule's left-packed stage (see the
                  // gooey dims), so label, field and counter share one edge.
                  expandedContent: (
                    <div className="py-1">
                      <div className="flex max-w-[504px] items-baseline justify-between gap-3 px-1 pb-1.5">
                        <p className="text-[13px] font-semibold text-slate-600">
                          What should it focus on?{" "}
                          <span className="font-normal text-slate-400">· optional</span>
                        </p>
                        <p
                          className="shrink-0 text-xs text-slate-400 tabular-nums"
                          aria-live="polite"
                        >
                          {steer.length} / {MAX_STEER_CHARS}
                        </p>
                      </div>
                      <div className="flex items-center justify-start overflow-x-clip">
                        <GooeyEmailInput
                          variant="light"
                          size="lg"
                          fieldWidth={420}
                          align="start"
                          gap={60}
                          duration={900}
                          placeholder="e.g. Emphasise their youth work"
                          inputType="text"
                          fieldLabel="What the booklet should focus on (optional)"
                          submitLabel="Accept this focus"
                          maxLength={MAX_STEER_CHARS}
                          value={steer}
                          onValueChange={onSteerChange}
                          validate={() => null}
                        />
                      </div>
                    </div>
                  ),
                },
                {
                  label: "Add a website",
                  alwaysExpanded: true,
                  expandedContent: (
                    <div className="flex items-center justify-start overflow-x-clip py-1">
                      <GooeyEmailInput
                        variant="light"
                        size="md"
                        align="start"
                        gap={56}
                        duration={900}
                        placeholder="https://example.org"
                        restPlaceholder="Add a website"
                        inputType="url"
                        fieldLabel="Website URL for extra context (optional)"
                        submitLabel="Check this website"
                        buttonIcon="x"
                        dropletLabel="Clear website"
                        onDropletClick={() => onWebsiteUrlChange("")}
                        value={websiteUrl}
                        onValueChange={onWebsiteUrlChange}
                        validate={() => null}
                        validateAsync={checkWebsite}
                        validationDelayMs={800}
                      />
                    </div>
                  ),
                },
              ]
        }
        onSubmit={() => void onGenerate()}
        submitLabel="Generate booklet"
        // A generation is a paid Gemini call, so the arrow asks first — and the
        // sheet re-states what this run will use, since the website and steer
        // were typed in a panel that is closed by the time it matters.
        confirm={{
          title: "Generate this booklet?",
          description:
            "Reads the client's profile and anything you added below. Takes a few seconds.",
          details: [
            { label: "Focus", value: steer.trim() || "No steer" },
            { label: "Website", value: websiteUrl.trim() || "None — profile only" },
          ],
          confirmLabel: "Generate",
        }}
        // The bar reports its own run: rolling square on the disc, status lines
        // where the prompt sits. Nothing appears below the card.
        submitting={busy}
        submittingMessages={STATUS_MESSAGES}
        className="w-full max-w-[600px]"
      />
    </div>
  );
}

export function BookletPanel({
  organisationId,
  savedBooklet,
  priorVersions,
  canDeleteBooklet = false,
}: {
  organisationId: string;
  savedBooklet: SavedBooklet | null;
  priorVersions: SavedBooklet[];
  /**
   * Whether the viewer may delete the displayed version. Admin-only, matching
   * the schema's delete policy — page.tsx passes actor.role === "admin", and
   * the action re-checks server-side regardless.
   */
  canDeleteBooklet?: boolean;
}) {
  // F085: seeded straight from the server-read CLIENT_BOOKLETS rows, so a client
  // with a saved booklet renders it on first paint with zero fetch and zero
  // Gemini cost (AC2). The route saves after every successful generate(), so this
  // is only stale within the current tab's own session.
  //
  // F086: CLIENT_BOOKLETS is append-only now (see that migration's header), so a
  // regenerate is a new row, never an overwrite — AC2 needs the prior version to
  // stay retrievable, not just timestamped. `history` holds every earlier version
  // this component knows about (seeded from `priorVersions`, then grown in place
  // each time generate() succeeds by archiving whatever was `currentVersion`
  // before the call). Old versions open in their own MorphingDialog
  // (HistoryVersionDialog above), so this card always shows the current one.
  const [currentVersion, setCurrentVersion] = useState<SavedBooklet | null>(savedBooklet);
  const [history, setHistory] = useState<SavedBooklet[]>(priorVersions);
  const [historyOpen, setHistoryOpen] = useState(false);
  // Regeneration is set up first: the header's Regenerate button reveals the
  // full composer (website + focus + confirm sheet) rather than firing a paid
  // call off the click itself.
  const [composerOpen, setComposerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Bumped per generation failure so a closed composer panel opens onto the
  // in-panel error row — an invisible error is no error at all.
  const [errorSignal, setErrorSignal] = useState(0);
  // Bumped by Try again so the composer reopens on the confirmation sheet
  // rather than firing a second generation straight off the failure.
  const [retrySignal, setRetrySignal] = useState(0);
  // Always empty on mount, and cleared again after each successful run: an
  // extra page to scrape is a per-run choice, not a client setting, and a
  // leftover URL reads as belonging to the version on screen.
  const [websiteUrl, setWebsiteUrl] = useState("");
  // Operator steer for the next generation only — never saved, never shown on
  // a version, cleared with the URL once its run succeeds. Each generation
  // reads what is typed at click time.
  const [steer, setSteer] = useState("");
  // Only meaningful for a version generated this session — it carries the skip
  // *reason* the API returns, which CLIENT_BOOKLETS never stores (only the
  // used/not-used boolean does). A page-load-seeded currentVersion, or any
  // historical one, falls back to the boolean-only derivation instead.
  const [freshWebsiteContext, setFreshWebsiteContext] = useState<WebsiteContextResult | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  // While a delete is armed-or-worse the Regenerate button stands down: a
  // regeneration landing mid-dissolve would give onComplete a stale version
  // set to promote. Generation in flight hides this whole action row instead.
  const [deleteArmed, setDeleteArmed] = useState(false);
  // Failed deletes bump the Delete button's key so a fresh idle button
  // remounts after the old one dissolves — the pending-invites pattern, for
  // the same reason: the button vanishes at the end of its snap regardless of
  // outcome, and without a new key a failed row would have no way to retry.
  const [deleteAttempts, setDeleteAttempts] = useState<Record<string, number>>({});
  // Versions whose delete resolved while the snap played. State swaps happen
  // in onComplete, never in onConfirm — unmounting on confirm would cut the
  // dissolve dead mid-animation.
  const deleteSucceeded = useRef<Set<string>>(new Set());
  const sectionRef = useRef<HTMLDivElement>(null);
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

  const displayed = currentVersion;
  const displayedSources = displayed?.sources ?? [];
  const displayedWebsiteContext =
    freshWebsiteContext ?? (currentVersion ? initialWebsiteContext(currentVersion) : null);

  async function generate() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    const startedAt = Date.now();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const trimmedUrl = websiteUrl.trim();
      const trimmedSteer = steer.trim();
      const response = await fetch(`/api/clients/${organisationId}/booklet`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(trimmedUrl ? { websiteUrl: trimmedUrl } : {}),
          ...(trimmedSteer ? { steer: trimmedSteer.slice(0, MAX_STEER_CHARS) } : {}),
        }),
        signal: controller.signal,
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error ?? "The booklet could not be generated. Try again.");
        setErrorSignal((n) => n + 1);
        return;
      }
      const websiteContextResult = (body.websiteContext as WebsiteContextResult | undefined) ?? null;
      const versionId = (body.versionId as string | null) ?? null;
      if (body.saved && !versionId) {
        // A save the server reports as successful must come back with its row id;
        // if it ever doesn't, that is a server contract break worth seeing, not
        // silently absorbing — the local fallback below is display-only and this
        // version would be unaddressable by any future server-side reference.
        console.warn("Booklet save reported success without a versionId");
      }
      const newVersion: SavedBooklet = {
        id: versionId ?? crypto.randomUUID(),
        text: body.booklet as string,
        websiteUrl: websiteContextResult?.status === "used" ? trimmedUrl || null : null,
        websiteContextUsed: websiteContextResult?.status === "used",
        generatedAt: (body.generatedAt as string | undefined) ?? new Date().toISOString(),
        // F087: the route's own authoritative list for this exact call (sources.ts),
        // not re-derived client-side — see route.ts's response comment.
        sources: (body.sources as BookletSource[] | undefined) ?? [{ type: "profile", verified: true }],
      };
      // F086 AC2: archive whatever was current, never discard it — a regenerate
      // is additive to history, not a replacement of it.
      setHistory((previous) => (currentVersion ? [currentVersion, ...previous] : previous));
      setCurrentVersion(newVersion);
      setFreshWebsiteContext(websiteContextResult);
      // A run's inputs are spent once it succeeds: leaving the previous URL
      // and focus typed in reads as leftover from the old version, and each
      // generation is a per-run choice read at click time.
      setWebsiteUrl("");
      setSteer("");
      setComposerOpen(false);
      setSaveFailed(body.saved === false);
    } catch {
      if (controller.signal.aborted) return;
      setError("Could not reach the server. Check your connection and try again.");
      setErrorSignal((n) => n + 1);
    } finally {
      // Hold the spinner to its floor (see MIN_GENERATION_SPIN_MS) — then the
      // usual abort guard, so navigating away mid-run still settles silently.
      const remaining = MIN_GENERATION_SPIN_MS - (Date.now() - startedAt);
      if (remaining > 0 && !controller.signal.aborted) {
        await new Promise((resolve) => setTimeout(resolve, remaining));
      }
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
    /* The wrapper exists only to hold the scroll target: arriving with
       ?booklet scrolls this card into view, and SectionCard does not forward a
       ref. */
    <div ref={sectionRef}>
      <SectionCard
        action={
          currentVersion && !busy ? (
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              {canDeleteBooklet && currentVersion && (
                <DeleteButton
                  key={`delete-booklet-${currentVersion.id}-${deleteAttempts[currentVersion.id] ?? 0}`}
                  label="Delete"
                  confirmLabel="Delete?"
                  deletingLabel="Deleting…"
                  size="sm"
                  variant="subtle"
                  onStartConfirm={() => setDeleteArmed(true)}
                  onCancel={() => setDeleteArmed(false)}
                  onConfirm={async () => {
                    const versionId = currentVersion.id;
                    const result = await deleteBookletVersion({
                      organisationId,
                      versionId,
                    });
                    if (result.ok) {
                      deleteSucceeded.current.add(versionId);
                      return;
                    }
                    setError(result.message);
                    setDeleteAttempts((previous) => ({
                      ...previous,
                      [versionId]: (previous[versionId] ?? 0) + 1,
                    }));
                  }}
                  onComplete={() => {
                    setDeleteArmed(false);
                    if (!currentVersion) return;
                    const versionId = currentVersion.id;
                    // The snap plays (and the button vanishes) whether the
                    // delete landed or not — only a recorded success swaps the
                    // versions. A failure remounted a fresh button above and
                    // leaves the content exactly where it was.
                    if (!deleteSucceeded.current.delete(versionId)) return;
                    setCurrentVersion(history[0] ?? null);
                    setHistory((previous) => previous.slice(1));
                    setFreshWebsiteContext(null);
                    setSaveFailed(false);
                  }}
                />
              )}
              <button
                className="shrink-0 rounded-full border border-rule px-4 py-2 text-xs font-semibold text-lead transition-colors hover:bg-lead-wash disabled:opacity-50"
                disabled={deleteArmed}
                onClick={() => setComposerOpen((open) => !open)}
                type="button"
                aria-expanded={composerOpen}
              >
                {composerOpen ? "Close" : "Regenerate"}
              </button>
            </div>
          ) : undefined
        }
        headingId="booklet-heading"
        hint="AI-generated research summary, for outreach preparation"
        icon={<Sparkles />}
        title="Client booklet"
      >

      {(!currentVersion || composerOpen) && (
        <BookletComposer
          busy={busy}
          websiteUrl={websiteUrl}
          onWebsiteUrlChange={setWebsiteUrl}
          steer={steer}
          onSteerChange={setSteer}
          error={error}
          openSignal={errorSignal}
          confirmSignal={retrySignal}
          onGenerate={() => void generate()}
          onRetry={() => {
            setError(null);
            setRetrySignal((n) => n + 1);
          }}
        />
      )}

      {/* While a run is in flight the bar wears it all: rolling square on the
          disc plus the cycling status line in the prompt row. Nothing renders
          below the bar — no separate loading block on either path. */}

      {/* Failures outside the composer report here: the arrival-time
          auto-generate (?booklet=generate) runs with no composer on screen.
          Its Try again opens the composer onto the error, rather than firing
          another paid call sight unseen. */}
      {error && !busy && currentVersion && !composerOpen && (
        <div className="mt-5 rounded-inset bg-stop-wash p-3" role="alert">
          <p className="text-sm font-semibold text-stop">{error}</p>
          <button
            className="mt-2 rounded-inset border border-stop/25 px-3 py-1 text-xs font-semibold text-stop"
            onClick={() => setComposerOpen(true)}
            type="button"
          >
            Try again
          </button>
        </div>
      )}

      {displayed && (
        <p className="mt-1 text-xs text-dim">
          Generated {formatGeneratedAt(displayed.generatedAt)}
          {saveFailed
            ? " — could not be saved, will re-generate next time this client is opened."
            : "."}
        </p>
      )}
      {/* F087 — Booklet Source References (AC1/AC2): profile data always shows,
          website only when it actually contributed — never listed as a source it
          wasn't (AC3). Rendered regardless of error state, consistent with the
          saved-content-stays-visible behaviour above. */}
      {displayed && displayedSources.length > 0 && (
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          {displayedSources.map((source) => (
            <SourceBadge key={source.type} source={source} />
          ))}
        </div>
      )}
      {displayed && displayedWebsiteContext?.status === "skipped" && (
        <p className="mt-1.5 flex items-start gap-1.5 text-xs font-medium text-hold">
          <Globe aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {`Website content not used — ${displayedWebsiteContext.reason}`}
        </p>
      )}
      {/* The current version stays on screen while its replacement generates —
          hiding it behind the run would discard exactly the artifact saving
          exists to preserve. */}
      {displayed && <BookletContent booklet={displayed.text} />}

      {/* F086 AC2: the timeline — every prior version opens on screen in its own
          dialog, rather than swapping the card. Collapsed by default so it
          doesn't compete with the booklet itself; only rendered once there's
          something to browse. */}
      {history.length > 0 && !busy && (
        <div className="mt-6 border-t border-rule pt-4">
          <button
            aria-expanded={historyOpen}
            className="flex items-center gap-1.5 text-xs font-semibold text-dim hover:text-ink"
            onClick={() => setHistoryOpen((open) => !open)}
            type="button"
          >
            <Clock aria-hidden="true" className="h-3.5 w-3.5" />
            {historyOpen ? "Hide" : "Show"} history ({history.length} prior version{history.length === 1 ? "" : "s"})
          </button>
          {historyOpen && (
            <ul className="mt-3 space-y-1.5">
              {history.map((version) => (
                <li
                  key={version.id}
                  className="flex items-center justify-between gap-2"
                >
                  <div className="min-w-0 flex-1">
                    <HistoryVersionDialog version={version} />
                  </div>
                  {canDeleteBooklet && (
                    <div className="shrink-0">
                      <DeleteButton
                        key={`delete-history-${version.id}-${deleteAttempts[version.id] ?? 0}`}
                        label="Delete"
                        confirmLabel="Delete?"
                        deletingLabel="Deleting…"
                        size="xs"
                        variant="subtle"
                        aria-label={`Delete booklet version from ${formatGeneratedAt(version.generatedAt)}`}
                        onStartConfirm={() => setDeleteArmed(true)}
                        onCancel={() => setDeleteArmed(false)}
                        onConfirm={async () => {
                          const result = await deleteBookletVersion({
                            organisationId,
                            versionId: version.id,
                          });
                          if (result.ok) {
                            deleteSucceeded.current.add(version.id);
                            return;
                          }
                          setError(result.message);
                          setDeleteAttempts((previous) => ({
                            ...previous,
                            [version.id]: (previous[version.id] ?? 0) + 1,
                          }));
                        }}
                        onComplete={() => {
                          setDeleteArmed(false);
                          if (!deleteSucceeded.current.delete(version.id)) return;
                          setHistory((previous) =>
                            previous.filter((v) => v.id !== version.id),
                          );
                        }}
                      />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      </SectionCard>
    </div>
  );
}
