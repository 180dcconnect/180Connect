"use client";

import { useEffect, useRef, useState } from "react";
import { Clock, ExternalLink, Globe, ShieldCheck, Sparkles } from "lucide-react";
import { AiLoadingState } from "@/components/ui/ai-loading-state";
import { parseBookletSections } from "@/lib/booklet/parse-sections";
import type { BookletSource } from "@/lib/booklet/sources";

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
 * F084 — Use Website URL in Booklet: the URL field below is pre-filled from the
 * client's already-known, already-reachable website (page.tsx passes
 * `initialWebsiteUrl`) but stays editable — a CAM can clear it, paste a different
 * page entirely, or fill one in when none is on record. Whatever's in the field at
 * generate time is what gets sent; the route re-validates it with F046's
 * validateWebsiteFormat and fetches it through F037's shared robots-aware,
 * SSRF-safe transport (scrape-website.ts) fresh on every click — nothing is cached,
 * same "no persistence yet" reasoning as the booklet itself. Whether the site's
 * content actually made it in is reported back as a status line under the booklet.
 *
 * F086 — Regenerate Client Booklet: CLIENT_BOOKLETS is append-only now (see that
 * migration's F086 revision), so a regenerate is a new row, never an overwrite —
 * AC2 needs the prior version to stay retrievable, not just timestamped. `history`
 * holds every earlier version this component knows about (seeded from
 * `priorVersions`, then grown in place each time generate() succeeds by archiving
 * whatever was `currentVersion` before the call). `viewingVersionId` picks a
 * historical entry to display read-only in place of the current one; it is purely
 * a local view toggle; nothing about the DB records or Regenerate's own behavior
 * changes while browsing history — regenerating always acts on "current", never on
 * whatever old version happens to be on screen, so a browsed history entry never
 * looks like it could be silently replaced by clicking Regenerate. Regenerate and
 * the URL field are hidden while a historical entry is shown for exactly that
 * reason; "Back to current" is the one action available there.
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

/**
 * F087 — AC2: verified (profile) and unverified (website) sources are visually
 * distinct by more than color alone — icon and wording both change, not just the
 * tone — so the distinction still reads for a CAM who can't rely on color.
 */
function SourceBadge({ source }: { source: BookletSource }) {
  if (source.type === "profile") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-brand/10 px-3 py-1 text-sm font-semibold text-brand-hover">
        <ShieldCheck aria-hidden="true" className="h-3.5 w-3.5" />
        Client profile — verified
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 text-sm font-semibold text-amber-800">
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

export function BookletPanel({
  organisationId,
  initialWebsiteUrl,
  savedBooklet,
  priorVersions,
}: {
  organisationId: string;
  initialWebsiteUrl: string | null;
  savedBooklet: SavedBooklet | null;
  priorVersions: SavedBooklet[];
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
  // before the call). `viewingVersionId` picks a historical entry to display
  // read-only in place of the current one; it is purely a local view toggle —
  // nothing about the DB records or Regenerate's own behaviour changes while
  // browsing history, and Regenerate plus the URL field are hidden while a
  // historical entry is shown, so there is no path where clicking something here
  // looks like it edits or replaces an old version.
  const [currentVersion, setCurrentVersion] = useState<SavedBooklet | null>(savedBooklet);
  const [history, setHistory] = useState<SavedBooklet[]>(priorVersions);
  const [viewingVersionId, setViewingVersionId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [websiteUrl, setWebsiteUrl] = useState(initialWebsiteUrl ?? "");
  // Only meaningful for a version generated this session — it carries the skip
  // *reason* the API returns, which CLIENT_BOOKLETS never stores (only the
  // used/not-used boolean does). A page-load-seeded currentVersion, or any
  // historical one, falls back to the boolean-only derivation instead.
  const [freshWebsiteContext, setFreshWebsiteContext] = useState<WebsiteContextResult | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
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

  // A viewing id that no longer resolves to a history entry (state corruption,
  // a future change that prunes history) is treated as not viewing at all, so
  // the read-only banner can never be orphaned and Regenerate never stays
  // hidden behind a stale id.
  const viewingVersion =
    viewingVersionId != null
      ? (history.find((version) => version.id === viewingVersionId) ?? null)
      : null;
  const displayed = viewingVersion ?? currentVersion;
  const displayedSources = displayed?.sources ?? [];
  const displayedWebsiteContext = viewingVersion
    ? initialWebsiteContext(viewingVersion)
    : (freshWebsiteContext ?? (currentVersion ? initialWebsiteContext(currentVersion) : null));

  async function generate() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const trimmedUrl = websiteUrl.trim();
      const response = await fetch(`/api/clients/${organisationId}/booklet`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(trimmedUrl ? { websiteUrl: trimmedUrl } : {}),
        signal: controller.signal,
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error ?? "The booklet could not be generated. Try again.");
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
      setViewingVersionId(null);
      setSaveFailed(body.saved === false);
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

        {(currentVersion || error) && !busy && !viewingVersion && (
          <button
            className="shrink-0 rounded-full border border-brand/30 px-4 py-2 text-xs font-bold text-brand transition-colors hover:bg-brand/10"
            onClick={generate}
            type="button"
          >
            Regenerate
          </button>
        )}
      </div>

      {!busy && !viewingVersion && (
        <div className="mt-4">
          <label
            className="mb-1.5 flex items-center gap-1.5 text-xs font-bold text-foreground/55"
            htmlFor="booklet-website-url"
          >
            <Globe aria-hidden="true" className="h-3.5 w-3.5" />
            Website URL for extra context (optional)
          </label>
          <input
            className="w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm text-foreground placeholder:text-foreground/40 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
            id="booklet-website-url"
            onChange={(event) => setWebsiteUrl(event.target.value)}
            onKeyDown={(event) => {
              // generate() itself refuses concurrent runs (inFlight guard), so a
              // second Enter mid-generation is a no-op, not a second paid call.
              if (event.key === "Enter") generate();
            }}
            placeholder="https://example.org"
            type="url"
            value={websiteUrl}
          />
        </div>
      )}

      {!currentVersion && !busy && !error && (
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

      {busy && (
        <AiLoadingState
          messages={STATUS_MESSAGES}
          reducedMotionLabel="Generating booklet — this can take several seconds…"
        />
      )}

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

      {/* F086: read-only banner while browsing a historical entry — the one exit
          is "Back to current", never Regenerate (hidden above), so there is no
          path where clicking something here looks like it edits an old version. */}
      {viewingVersion && !busy && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-amber-50 px-3 py-2.5">
          <p className="flex items-center gap-1.5 text-xs font-medium text-amber-800">
            <Clock aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
            Viewing an older version — generated {formatGeneratedAt(viewingVersion.generatedAt)}
          </p>
          <button
            className="shrink-0 text-xs font-bold text-amber-800 underline underline-offset-2 hover:text-amber-900"
            onClick={() => setViewingVersionId(null)}
            type="button"
          >
            Back to current
          </button>
        </div>
      )}

      {/* F085/F086: the saved/generated booklet stays visible even when a
          regeneration fails — hiding it behind the error box would discard exactly
          the artifact saving exists to preserve, and F086 makes the prior version
          retrievable by design, so the error state must not undo that in the UI.
          The error box above makes clear that what's shown below is the previous
          version, not a fresh generation. */}
      {displayed && !busy && (
        <p className="mt-1 text-xs text-foreground/45">
          Generated {formatGeneratedAt(displayed.generatedAt)}
          {!viewingVersion && saveFailed
            ? " — could not be saved, will re-generate next time this client is opened."
            : "."}
        </p>
      )}
      {/* F087 — Booklet Source References (AC1/AC2): profile data always shows,
          website only when it actually contributed — never listed as a source it
          wasn't (AC3). Rendered regardless of error state, consistent with the
          saved-content-stays-visible behaviour above. */}
      {displayed && !busy && displayedSources.length > 0 && (
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          {displayedSources.map((source) => (
            <SourceBadge key={source.type} source={source} />
          ))}
        </div>
      )}
      {displayed && !busy && displayedWebsiteContext?.status === "skipped" && (
        <p className="mt-1.5 flex items-start gap-1.5 text-xs font-medium text-amber-700">
          <Globe aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {`Website content not used — ${displayedWebsiteContext.reason}`}
        </p>
      )}
      {displayed && !busy && <BookletContent booklet={displayed.text} />}

      {/* F086 AC2: the timeline — every prior version stays retrievable, not just
          timestamped. Collapsed by default so it doesn't compete with the
          booklet itself; only rendered once there's something to browse. */}
      {history.length > 0 && !busy && !viewingVersion && (
        <div className="mt-6 border-t border-black/[0.06] pt-4">
          <button
            aria-expanded={historyOpen}
            className="flex items-center gap-1.5 text-xs font-bold text-foreground/60 hover:text-foreground/80"
            onClick={() => setHistoryOpen((open) => !open)}
            type="button"
          >
            <Clock aria-hidden="true" className="h-3.5 w-3.5" />
            {historyOpen ? "Hide" : "Show"} history ({history.length} prior version{history.length === 1 ? "" : "s"})
          </button>
          {historyOpen && (
            <ul className="mt-3 space-y-1.5">
              {history.map((version) => (
                <li key={version.id}>
                  <button
                    className={`w-full rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                      viewingVersionId === version.id
                        ? "bg-brand/10 font-bold text-brand-hover"
                        : "text-foreground/65 hover:bg-black/[0.03]"
                    }`}
                    onClick={() => setViewingVersionId(version.id)}
                    type="button"
                  >
                    Generated {formatGeneratedAt(version.generatedAt)}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
