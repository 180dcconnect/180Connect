"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import { Plus, X } from "lucide-react";

import { EASE } from "@/components/brand/motion";
import { BackButton } from "@/components/ui/back-button";
import { OriginButton } from "@/components/ui/origin-button";
import { InlineAlert } from "@/components/ui/inline-alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/animate-ui/components/radix/dialog";
import { deleteManualEntryDraft } from "./actions";
import { UrlImportForm } from "./url-import-form";
import { ManualEntryForm, type ManualEntryDraft } from "./manual-entry-form";
import { RegisterLookupPanel, type RegisterMatch } from "./register-lookup-panel";
import { DisclosureSection } from "./disclosure-section";

/**
 * The Add-a-client screen's two views: the lists, and the composer.
 *
 * ── Why the lists are the landing view ──
 *
 * The same trade the Charity Commission screen makes. Arriving, the useful
 * picture is what was added recently and what is still in draft; adding
 * another is the action on that picture, one click away. A draft opened from
 * the list (`?draft=…`) goes straight to the composer.
 *
 * ── Why this is state and not a route ──
 *
 * Both views stay mounted and one is hidden, so switching is instant. But the
 * composer is not a place to come back to: "Add a client" always opens a blank
 * form, and a draft is reopened from the Drafts list. Stepping back drops
 * `?draft=` / `?contact_email=` from the URL (or just refreshes) to bring the
 * lists up to date with what was saved.
 *
 * ── Nothing saves itself ──
 *
 * A draft exists because someone pressed "Save draft", and a client because
 * someone pressed "Add client". So leaving a form with unsaved changes asks:
 * save them as a draft, discard them, or keep editing. Closing the tab gets the
 * browser's own "leave site?" prompt for the same reason.
 *
 * ── The ways in ──
 *
 * The register search and the website reader are collapsible rows above the
 * form. The website reader is open on arrival and the register search folded:
 * both are there without either standing between the person and the details.
 *
 * ── Why prefill lives here ──
 *
 * The register lookup and the form are siblings that need to talk: picking a
 * match has to reach the fields without a round trip. A match is applied by
 * *remounting* the form — the fields are uncontrolled by design, and a key change
 * is the one way to re-seed them all at once.
 */

type WayIn = "register" | "website";

interface ConsoleContextValue {
  openComposer: () => void;
}

const ConsoleContext = createContext<ConsoleContextValue | null>(null);

/** The primary action, rendered in the lists' header through context. */
export function NewClientButton() {
  const context = useContext(ConsoleContext);
  if (!context) return null;

  return (
    <button
      className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-inset border border-lead bg-lead px-2.5 py-1 text-[13px] font-medium text-white transition-colors hover:bg-lead-mid focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lead/30"
      onClick={context.openComposer}
      type="button"
    >
      <Plus className="size-3.5" strokeWidth={2.6} />
      Add a client
    </button>
  );
}

function PrefillNotice({ match, onClear }: { match: RegisterMatch; onClear: () => void }) {
  return (
    <div className="mb-4 rounded-panel border border-lead/20 bg-lead-wash px-5 py-3.5">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <p className="text-[13px] font-semibold text-lead">
          Filled from {match.registryName}
          {match.registryNumber && <> · {match.registryNumber}</>}
        </p>
        <button
          className="inline-flex cursor-pointer items-center gap-1 text-[12.5px] font-semibold text-lead/80 transition-colors hover:text-lead"
          onClick={onClear}
          type="button"
        >
          <X aria-hidden className="size-3.5" strokeWidth={2.4} />
          Clear
        </button>
      </div>
      <p className="mt-1.5 text-[13px] leading-[1.6] text-ink/80">
        These are the register&rsquo;s own values, not ours. Check each one before
        you submit — a register spells a name its own way, and the mission is the
        charity&rsquo;s filed description rather than a summary of it. Nothing is
        saved until you do.
      </p>
    </div>
  );
}

const ROW_HEADING = "font-body text-[18px] leading-[1.3] font-semibold tracking-[-0.01em] text-ink";
const ROW_ASIDE = "font-body text-[13px] text-dim";

export function NewClientConsole({
  home,
  initialEntry,
  isAdmin,
  prefillContactEmail,
  initialMode = "home",
}: {
  /** Server-rendered landing view: recently added and drafts. */
  home: ReactNode;
  initialEntry: ManualEntryDraft | null;
  isAdmin: boolean;
  prefillContactEmail?: string | null;
  /** `composer` when the page was opened on a draft or an inbox prefill. */
  initialMode?: "home" | "composer";
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"home" | "composer">(initialMode);
  const [wayIn, setWayIn] = useState<WayIn | null>("website");
  // The whole match, not just its fields: the notice above the form has to be
  // able to name the register and the number the values came from.
  const [prefill, setPrefill] = useState<RegisterMatch | null>(null);
  // Bumped on every prefill, and on every fresh "Add a client", so the form
  // remounts and re-seeds. Part of the key rather than a separate reset flag,
  // because two prefills in a row with the same contents would otherwise leave
  // the second one invisible.
  const [formSeq, setFormSeq] = useState(0);
  // What the composer was opened on. State, not the prop, so "Add a client" can
  // let go of it before the URL change lands.
  const [entry, setEntry] = useState(initialEntry);
  const [contactEmail, setContactEmail] = useState(prefillContactEmail ?? null);
  // The draft this composer has saved. Held here, above the form's key, so a
  // register prefill remounting the form keeps writing to the same row.
  const [draftId, setDraftId] = useState<string | null>(initialEntry?.id ?? null);
  const onDraftSaved = useCallback((id: string) => setDraftId(id), []);

  // Whether the form holds changes nobody has saved, reported up by the form.
  const [dirty, setDirty] = useState(false);
  const onDirtyChange = useCallback((value: boolean) => setDirty(value), []);
  // The form's own "Save draft", callable from the leave dialog. Set by the form.
  const saveDraftRef = useRef<(() => Promise<string | null>) | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [leaveSaving, setLeaveSaving] = useState(false);
  const [leaveError, setLeaveError] = useState<string | null>(null);

  useEffect(() => {
    if (mode !== "composer" || !dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [mode, dirty]);

  const scrollTop = () => window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });

  // Back to a blank form: no draft, no register match, no inbox email.
  const resetComposer = () => {
    setEntry(null);
    setContactEmail(null);
    setDraftId(null);
    setPrefill(null);
    setWayIn("website");
    setDirty(false);
    setFormSeq((value) => value + 1);
  };

  const openBlankComposer = () => {
    resetComposer();
    setMode("composer");
    scrollTop();
  };

  /**
   * "Clear all". An empty form is not a draft (the same rule autosave follows),
   * so clearing also deletes the draft row this composer saved, if any — left
   * behind, it would sit in the list as an "Untitled client". The form disables
   * the button while a save is in flight, so no autosave can land after the
   * delete and bring the row back. Returns an error message, or null when done.
   */
  const clearComposer = async (): Promise<string | null> => {
    if (draftId) {
      const result = await deleteManualEntryDraft(draftId);
      if (!result.ok) return result.message;
    }
    // Drop ?draft= without a navigation: a route change would remount the
    // console back onto the lists, and the person asked to stay in the form.
    if (window.location.search) window.history.replaceState(null, "", "/clients/new");
    resetComposer();
    scrollTop();
    return null;
  };

  const backToLists = () => {
    setLeaving(false);
    setLeaveError(null);
    setDirty(false);
    setMode("home");
    scrollTop();
    // Draft saves do not revalidate (see saveManualEntry), so the lists may be
    // stale. A URL still naming a draft or an inbox prefill is dropped; otherwise
    // a refresh is enough. The composer is hidden by now, and the next
    // "Add a client" remounts it blank regardless.
    if (window.location.search) router.replace("/clients/new", { scroll: false });
    else router.refresh();
  };

  // A submit that went through: blank the composer and land on the lists, with
  // `?added=` telling them which row to confirm and mark.
  const onSubmitted = (entryId: string) => {
    resetComposer();
    setMode("home");
    scrollTop();
    router.replace(`/clients/new?added=${entryId}`, { scroll: false });
  };

  const requestBack = () => {
    if (dirty) setLeaving(true);
    else backToLists();
  };

  const saveAndLeave = async () => {
    if (!saveDraftRef.current) return;
    setLeaveSaving(true);
    setLeaveError(null);
    const message = await saveDraftRef.current();
    setLeaveSaving(false);
    if (message) setLeaveError(message);
    else backToLists();
  };

  const applyPrefill = (match: RegisterMatch) => {
    setPrefill(match);
    setFormSeq((value) => value + 1);
    setWayIn(null);
    // The form is below the lookup, and the whole point of the button is to
    // show the result of it. Scrolling is what makes the two read as one act.
    requestAnimationFrame(() => {
      document
        .getElementById("client-details-heading")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  // Reviewing a website import: the person is finishing one, not starting
  // another, and a search beside a half-checked draft invites replacing it.
  const offerWaysIn = !entry?.source_url;

  return (
    <ConsoleContext.Provider value={{ openComposer: openBlankComposer }}>
      <motion.div
        animate={{ opacity: mode === "home" ? 1 : 0, y: mode === "home" ? 0 : 6 }}
        className={mode === "home" ? "space-y-4" : "hidden"}
        transition={{ duration: 0.25, ease: EASE }}
      >
        {home}
      </motion.div>

      <motion.div
        animate={{ opacity: mode === "composer" ? 1 : 0, y: mode === "composer" ? 0 : 6 }}
        className={mode === "composer" ? "space-y-8" : "hidden"}
        transition={{ duration: 0.25, ease: EASE }}
      >
        <BackButton label="Recently added" onClick={requestBack} />

        <Dialog
          onOpenChange={(open) => {
            if (!open && !leaveSaving) {
              setLeaving(false);
              setLeaveError(null);
            }
          }}
          open={leaving}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{draftId ? "Save your changes?" : "Save this as a draft?"}</DialogTitle>
              <DialogDescription>
                {draftId
                  ? "You changed this draft since it was last saved. Save the changes, or leave them and keep the draft as it was."
                  : "Nothing here has been saved. Keep it as a draft to finish later, or discard it."}
              </DialogDescription>
            </DialogHeader>
            {leaveError && <InlineAlert variant="inline" tone="error" message={leaveError} />}
            <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
              <button
                className="cursor-pointer rounded-inset px-3 py-1.5 text-[13px] font-semibold text-dim transition-colors hover:text-ink disabled:cursor-default disabled:opacity-60"
                disabled={leaveSaving}
                onClick={() => {
                  setLeaving(false);
                  setLeaveError(null);
                }}
                type="button"
              >
                Keep editing
              </button>
              <OriginButton disabled={leaveSaving} onClick={backToLists} size="md" type="button" variant="outline">
                {draftId ? "Discard changes" : "Discard"}
              </OriginButton>
              <OriginButton
                disabled={leaveSaving}
                loading={leaveSaving}
                onClick={saveAndLeave}
                size="md"
                type="button"
              >
                {leaveSaving ? "Saving…" : draftId ? "Save changes" : "Save as draft"}
              </OriginButton>
            </div>
          </DialogContent>
        </Dialog>

        {/* One column, the page's full width: the ways in, then the details. */}
        <div className="space-y-8">
        {offerWaysIn && (
          <section aria-labelledby="ways-in-heading">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <h2 className={ROW_HEADING} id="ways-in-heading">
                Fill it in for you
              </h2>
              <p className={ROW_ASIDE}>Optional — or go straight to the details.</p>
            </div>
            <div className="mt-3 rounded-panel border border-rule bg-white px-5">
              <DisclosureSection
                closedLabel="Open"
                id="website"
                onToggle={() => setWayIn(wayIn === "website" ? null : "website")}
                open={wayIn === "website"}
                openLabel="Hide"
                summary="For an organisation in neither register"
                title="Start from their website"
              >
                <p className="mb-3.5 text-[13px] leading-[1.55] text-dim">
                  Reads what the page publishes, picks out any registration numbers and fills the
                  details below. Nothing is saved until you check it and submit.
                </p>
                <UrlImportForm />
              </DisclosureSection>
              <DisclosureSection
                closedLabel="Search"
                id="register"
                onToggle={() => setWayIn(wayIn === "register" ? null : "register")}
                open={wayIn === "register"}
                openLabel="Hide"
                status={prefill ? "complete" : null}
                summary={
                  prefill
                    ? `Used ${prefill.name}`
                    : "Charities and companies from third-party sources — the most complete record"
                }
                title="Find them in a register"
              >
                <RegisterLookupPanel onUseDetails={applyPrefill} />
              </DisclosureSection>
            </div>
          </section>
        )}

        <section aria-labelledby="client-details-heading" className="scroll-mt-6">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h2 className={ROW_HEADING} id="client-details-heading">
              {entry ? `Draft: ${entry.legal_name || "untitled client"}` : "Client details"}
            </h2>
            <p className={ROW_ASIDE}>Save a draft at any point.</p>
          </div>
          <div className="mt-3">
            {prefill && <PrefillNotice match={prefill} onClear={() => setPrefill(null)} />}
            <ManualEntryForm
              draftId={draftId}
              initialEntry={entry}
              isAdmin={isAdmin}
              onClearAll={clearComposer}
              onDirtyChange={onDirtyChange}
              onDraftSaved={onDraftSaved}
              onSubmitted={onSubmitted}
              saveDraftRef={saveDraftRef}
              prefill={prefill?.prefill ?? null}
              prefillContactEmail={entry?.contact_email ?? contactEmail}
              // See the note on formSeq: the key is what re-seeds the
              // uncontrolled fields.
              key={`${entry?.id ?? "new"}:${formSeq}`}
            />
          </div>
        </section>
        </div>
      </motion.div>
    </ConsoleContext.Provider>
  );
}
