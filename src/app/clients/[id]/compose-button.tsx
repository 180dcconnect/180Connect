"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Check, History, Inbox, PenLine } from "lucide-react";
import { LoaderPinwheel } from "@/components/animate-ui/icons/loader-pinwheel";
import {
  EmailReviewPanel,
  type EmailReviewDirtyState,
} from "@/components/outreach/email-review-panel";
import type { Attachment } from "@/lib/attachments";
import { CLOSING_APPROACHES, EMAIL_LENGTHS, EMAIL_REGISTER_LABELS, EMAIL_REGISTERS, OPENING_APPROACHES, SIZE_TEMPLATES, SIZE_TONE_LABELS, type ClosingApproach, type EmailLength, type EmailRegister, type OpeningApproach, type SizeTemplate } from "@/lib/outreach/stage-one-prompt";
import { AiThinkingState } from "@/components/ui/ai-thinking-state";
import { StreamingDraftText } from "@/components/ui/streaming-draft-text";
import { useStageOneDraftStream } from "@/components/outreach/use-stage-one-draft-stream";
import { SectionCard } from "./section-card";
import { AiSettingsPicker, type AiSettingEntry } from "@/components/outreach/ai-settings-picker";
import { formatScheduleLong } from "@/components/outreach/schedule-send-dialog";

type Tone = "block" | "conflict";
type Warning = { text: string; tone: Tone };
type Draft = {
  id: string;
  subject: string;
  body: string;
  sizeTemplate?: string;
  recipientOnFile: string | null;
  // The recipient exactly as last persisted (F119 AC1). Undefined on a
  // freshly generated draft (nothing saved yet); set once saved or when the
  // draft was reopened from the database. Drives the regenerate-confirm
  // baseline together with recipientOnFile.
  savedRecipient?: string | null;
};
type ExistingDraft = Draft & { savedRecipient: string | null };

const EMAIL_LENGTH_LABELS: Record<EmailLength, string> = {
  short: "Short",
  standard: "Standard",
  detailed: "Detailed",
};

const OPENING_APPROACH_LABELS: Record<OpeningApproach, string> = {
  mission_led: "Mission-led",
  direct_intro: "Direct introduction",
  news_hook: "Relevant news hook",
};

const CLOSING_APPROACH_LABELS: Record<ClosingApproach, string> = {
  soft_cta: "Soft invitation",
  meeting_request: "Request a short call",
  open_question: "Open question",
};

function sizeTemplateLabel(sizeTemplate: string | undefined): string {
  return sizeTemplate && SIZE_TEMPLATES.includes(sizeTemplate as SizeTemplate)
    ? SIZE_TONE_LABELS[sizeTemplate as SizeTemplate]
    : SIZE_TONE_LABELS.default;
}

/**
 * F019 (#22): a client owned by another CAM is visible in full, but its
 * outreach actions are not available — the button is dead on arrival rather
 * than clickable-then-refused. `blocked` stays the harder state (suppression);
 * `ownershipBlocked` renders the same disabled shape in the softer conflict
 * tone. The server-side preflight behind `generate()` still re-checks both,
 * so this is presentation over an enforcement that does not depend on it.
 *
 * F100 creates a review draft only, after the current outreach preflight passes.
 *
 * F103: `hasSavedBooklet` comes from the server page (does a saved booklet exist in
 * client_booklets?) and only drives the hint text — the route itself re-reads the
 * saved booklet, so the hint can never promise more than generation will use.
 *
 * F111 (#108) regenerates in place — same card, same draft row, new content.
 * Styled to match BookletPanel (booklet-panel.tsx), the app's other one-shot
 * Gemini-backed action: same brand-tinted card, same dashed empty-state box with
 * a prominent CTA, same small header pill once a result exists to regenerate.
 *
 * `historyHref`, when provided, links to this client's slice of
 * /admin/ai-generations (F112 AC3's "accessible without direct database access"
 * — this is the shortcut so nobody has to be walked through "go to the admin
 * dashboard, open AI generation history, then find this client"). Only ever
 * passed by page.tsx when the viewer actually has permission to land there —
 * always shown regardless of local draft state.
 *
 * F119: `existingDraft`, when page.tsx found one, hydrates the review section
 * on first render so a CAM reopening this client sees exactly what they last
 * saved instead of a blank editor — see `saveDraft` below for the write side.
 */
export function ComposeButton({
  blocked,
  ownershipBlocked = false,
  adminOverrideOwnerName = null,
  organisationId,
  suppressionReason,
  ownershipWarning,
  hasSavedBooklet = false,
  historyHref,
  existingDraft = null,
  clientAttachments = [],
}: {
  blocked: boolean;
  ownershipBlocked?: boolean;
  // F018 (#21) AC3: set only when an admin is viewing a client owned by another
  // CAM. Send/Schedule then require a last-resort confirmation naming the owner
  // before outreach-actions.ts runs — the server-side rule itself never blocks
  // admins, this dialog is the deliberate friction the ticket asks for.
  adminOverrideOwnerName?: string | null;
  organisationId: string;
  suppressionReason?: string;
  ownershipWarning?: string;
  hasSavedBooklet?: boolean;
  historyHref?: string;
  existingDraft?: ExistingDraft | null;
  clientAttachments?: readonly Attachment[];
}) {
  const [draft, setDraft] = useState<Draft | null>(
    existingDraft ? { ...existingDraft, sizeTemplate: undefined } : null,
  );
  // A hand-written draft has no size-tone template and nothing to regenerate,
  // so the card has to remember which kind is open. A reopened saved draft
  // (existingDraft) counts as written: it may have been edited by hand since,
  // and offering "Regenerate" on it would risk replacing work with a guess.
  const [manual, setManual] = useState(existingDraft !== null);
  // Set once the draft has actually left, so the card can say so and offer the
  // thread — see `committed` below.
  const [committed, setCommitted] = useState<
    { kind: "sent" | "scheduled"; scheduledFor?: string } | null
  >(null);
  // Regeneration updates the same outreach_messages row in place (F111 AC2),
  // so `draft.id` does not change and cannot key the review panel's remount.
  // This does, incremented on every successful (re)generate, so the panel
  // reinitializes with the new content instead of keeping edits to the old.
  const [generation, setGeneration] = useState(0);
  // F123's reviewed content lives inside EmailReviewPanel, which owns it along
  // with the approval gate and the send/save/schedule/discard actions. All this
  // side needs back is whether regenerating would throw work away — reported
  // through onDirtyChange into this ref, read only inside `generate`. A ref
  // rather than state: nothing here re-renders on an edit, and making it state
  // would re-render the whole card on every keystroke in the editor.
  const dirty = useRef<EmailReviewDirtyState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Spins the generate icon for as long as the button is hovered — the icon
  // alone is a smaller hover target than the button around it.
  const [aiHover, setAiHover] = useState(false);
  // Token stream for the draft: thinking steps and live text while it flows,
  // resolving like the old JSON POST so the flow below is unchanged.
  const draftStream = useStageOneDraftStream();
  // A finished draft waits here while its reveal plays out (ticks, then
  // words). The review editor takes it in commitStagedDraft, once the last
  // word has resolved — handing over mid-reveal would cut the text off.
  const [stagedDraft, setStagedDraft] = useState<Draft | null>(null);

  function commitStagedDraft() {
    if (!stagedDraft) return;
    setManual(false);
    setDraft(stagedDraft);
    setGeneration((current) => current + 1);
    dirty.current = null;
    setStagedDraft(null);
    setBusy(false);
  }
  const [warning, setWarning] = useState<Warning | null>(
    blocked
      ? {
          text: `This client is suppressed. Outreach is blocked. Reason: ${suppressionReason ?? "No reason was recorded."}`,
          tone: "block",
        }
      : ownershipBlocked || ownershipWarning
        ? { text: ownershipWarning ?? "Outreach is unavailable on this client.", tone: "conflict" }
        : null,
  );
  const [length, setLength] = useState<EmailLength>("standard");
  const [register, setRegister] = useState<EmailRegister>("professional");
  const [opening, setOpening] = useState<OpeningApproach>("mission_led");
  const [closing, setClosing] = useState<ClosingApproach>("soft_cta");

  // The five dials for the drill-down picker — same shape the compose modal
  // builds for its own AI picker, one entry per setting.
  const aiSettings: AiSettingEntry[] = [
    {
      key: "length",
      label: "Email length",
      hint: "How long the email body should be.",
      options: EMAIL_LENGTHS.map((value) => ({ value, label: EMAIL_LENGTH_LABELS[value] })),
      selected: length,
      onSelect: (value) => setLength(value as EmailLength),
    },
    {
      key: "register",
      label: "Email register",
      hint: "How formal and how warm the email reads. Every email is written as \u201cwe\u201d either way.",
      options: EMAIL_REGISTERS.map((value) => ({ value, label: EMAIL_REGISTER_LABELS[value] })),
      selected: register,
      onSelect: (value) => setRegister(value as EmailRegister),
    },
    {
      key: "opening",
      label: "Opening approach",
      options: OPENING_APPROACHES.map((value) => ({ value, label: OPENING_APPROACH_LABELS[value] })),
      selected: opening,
      onSelect: (value) => setOpening(value as OpeningApproach),
    },
    {
      key: "closing",
      label: "Closing approach",
      options: CLOSING_APPROACHES.map((value) => ({ value, label: CLOSING_APPROACH_LABELS[value] })),
      selected: closing,
      onSelect: (value) => setClosing(value as ClosingApproach),
    },
  ];

  /**
   * "Draft manually" — an empty draft row, then the same review panel.
   *
   * The panel's rich-text editor IS the manual composer; there was never a
   * second editor to build. What was missing was a row to save into, since the
   * panel saves, sends, schedules and discards by message id. The blank route
   * creates one behind the same ownership and suppression checks generation
   * runs behind.
   */
  async function draftManually() {
    setBusy(true);
    setError(null);
    setWarning(null);
    try {
      const response = await fetch(`/api/clients/${organisationId}/outreach-drafts/blank`, {
        method: "POST",
      });
      const payload = await response.json();
      if (!response.ok) {
        // An ownership conflict or a suppression is a standing fact about the
        // client, not a failed request — it belongs in the warning line, in the
        // tone that says which.
        if (response.status === 409) {
          setWarning({
            text: payload.error ?? "Outreach is unavailable on this client.",
            tone: payload.kind === "ownership_conflict" ? "conflict" : "block",
          });
        } else {
          setError(payload.error ?? "The draft could not be created. Try again.");
        }
        return;
      }
      setManual(true);
      setDraft(payload as Draft);
      setGeneration((current) => current + 1);
      dirty.current = null;
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function generate() {
    // F111 — Regenerate Email Draft (#108), "Important usability": regenerating
    // replaces the visible draft outright (AC2), which would silently throw away
    // any edits the CAM already made to it. Confirm first, but only when there's
    // actually something to lose.
    // F116: an edited recipient counts as "something to lose" too — the confirm
    // must fire before regeneration resets it. The saved recipient is the clean
    // baseline once persisted (F119), falling back to the on-file address.
    if (
      draft &&
      dirty.current &&
      (dirty.current.recipient !== (draft.savedRecipient ?? draft.recipientOnFile ?? "") ||
        dirty.current.subject !== draft.subject ||
        dirty.current.bodyEdited)
    ) {
      if (!window.confirm("Regenerating will replace this draft and discard your edits. Continue?")) {
        return;
      }
    }

    setBusy(true);
    setError(null);
    setWarning(null);
    try {
      const preflight = await fetch(`/api/clients/${organisationId}/outreach-preflight`, {
        method: "POST",
      });
      const preflightBody = await preflight.json();
      if (!preflight.ok || !preflightBody.allowed) {
        setWarning({
          text: preflightBody.error ?? "Outreach permissions could not be verified. Nothing was sent.",
          tone: preflightBody.kind === "ownership_conflict" ? "conflict" : "block",
        });
        return;
      }

      const outcome = await draftStream.start({
        organisationId,
        ...(draft ? { draftId: draft.id } : {}),
        length,
        register,
        opening,
        closing,
      });
      if (!outcome.ok) {
        if (outcome.error === "cancelled") {
          setBusy(false);
          return;
        }
        setError(outcome.error);
        // A 409 means the draft this session was tracking no longer exists as one
        // (sent or removed elsewhere) — drop it so "Try again" starts a fresh draft
        // instead of retrying an update that can only ever fail the same way.
        if (outcome.status === 409) setDraft(null);
        setBusy(false);
        return;
      }
      // Bumping `generation` remounts EmailReviewPanel — but only in
      // commitStagedDraft, after the reveal below has played out.
      setStagedDraft(outcome.result as Draft);
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
      setBusy(false);
    }
  }

  const historyLink = historyHref && (
    <Link
      className="flex shrink-0 items-center gap-1.5 rounded-full border border-rule px-4 py-2 text-xs font-semibold text-lead transition-colors hover:bg-lead-wash"
      href={historyHref}
    >
      <History aria-hidden="true" className="h-3.5 w-3.5" />
      History
    </Link>
  );

  if (blocked || ownershipBlocked) {
    return (
      <SectionCard
        action={historyLink}
        headingId="stage-one-heading"
        hint="AI-generated outreach draft, for CAM review before sending"
        icon={<PenLine />}
        title="Introductory email"
        tone="danger"
      >
        <p
          className={`mt-4 text-[13px] font-semibold leading-[1.6] ${warning?.tone === "conflict" ? "text-hold" : "text-stop"}`}
          role="alert"
        >
          {warning?.text}
        </p>
      </SectionCard>
    );
  }

  return (
    <SectionCard
      action={
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {/* Nothing to regenerate on a hand-written draft — pressing it would
              replace the CAM's own words with a guess. */}
          {(draft || error) && !busy && !manual && !committed && (
            <button
              className="shrink-0 rounded-full border border-rule px-4 py-2 text-xs font-semibold text-lead transition-colors hover:bg-lead-wash"
              onClick={generate}
              type="button"
            >
              Regenerate
            </button>
          )}
          {historyLink}
        </div>
      }
      headingId="stage-one-heading"
      hint="AI-generated outreach draft, for CAM review before sending"
      icon={<PenLine />}
      title="Introductory email"
    >

      {!draft && !busy && !committed && (
        <div className="mt-4">
          <p className="text-xs text-dim" aria-live="polite">
            {hasSavedBooklet
              ? "The client's saved booklet is included as additional context."
              : "Generate the client booklet first to include its insights in this email."}
          </p>
          {/* AI-first, like the compose window: the settings ARE the empty
              state, and both ways in sit on them. What used to be here was a
              dashed box below the card holding "Generate Stage 1 email", which
              put the action a card away from the dials it reads — and offered
              no way to write the email by hand at all. */}
          <AiSettingsPicker
            disabled={busy}
            footer={
              <>
                <button
                  className="pointer-events-auto inline-flex items-center gap-1.5 rounded-lg bg-lead px-4 py-2 text-[12px] font-bold text-white shadow-[0_12px_28px_-12px_rgba(35,64,122,0.75)] transition-colors hover:bg-[#1b3160]"
                  onClick={generate}
                  onMouseEnter={() => setAiHover(true)}
                  onMouseLeave={() => setAiHover(false)}
                  title="Generate the first draft from the settings above"
                  type="button"
                >
                  <LoaderPinwheel animate={aiHover} size={14} aria-hidden="true" />
                  Generate draft
                </button>
                <button
                  className="pointer-events-auto inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-white/80 px-3 py-2 text-[12px] font-semibold text-slate-700 shadow-[0_8px_20px_-10px_rgba(15,23,42,0.4)] backdrop-blur-sm transition-colors hover:bg-white hover:text-slate-900"
                  onClick={draftManually}
                  title="Write the email yourself, with no AI draft"
                  type="button"
                >
                  <PenLine aria-hidden="true" className="h-3.5 w-3.5" />
                  Draft manually
                </button>
              </>
            }
            settings={aiSettings}
          />
        </div>
      )}

      {warning && (
        <p
          className={`mt-4 text-[13px] font-semibold leading-[1.6] ${warning.tone === "conflict" ? "text-hold" : "text-stop"}`}
          role="alert"
        >
          {warning.text}
        </p>
      )}

      {busy && (
        <>
          <AiThinkingState stage={draftStream.displayStage} startedAt={draftStream.startedAt} />
          {draftStream.displayStage === "done" && (
            <StreamingDraftText
              subject={draftStream.subject}
              body={draftStream.body}
              streaming={draftStream.status === "streaming"}
              onRevealComplete={commitStagedDraft}
            />
          )}
        </>
      )}

      {error && !busy && (
        <div className="mt-5 rounded-inset bg-stop-wash p-3" role="alert">
          <p className="text-sm font-semibold text-stop">{error}</p>
          <button
            className="mt-2 rounded-inset border border-stop/25 px-3 py-1 text-xs font-semibold text-stop"
            onClick={generate}
            type="button"
          >
            Try again
          </button>
        </div>
      )}

      {/* Sent or scheduled. The card used to collapse straight back to its
          empty state here, which left the CAM with no confirmation and no way
          to go and look at what had just gone out. `onCommitted` is what makes
          this possible: onDraftCleared fires for a discard too, so it cannot
          tell a delivered email from a thrown-away one.

          "View in inbox" resolves because a thread IS an organisation — the
          mailbox keys on organisation_id, and a just-sent message means the
          inbox now has a real thread for this client. */}
      {committed && !busy && (
        <div className="mt-5 rounded-inset border border-go/20 bg-go-wash p-4" role="status">
          <p className="flex items-center gap-2 text-[13px] font-semibold text-ink">
            <Check aria-hidden="true" className="h-4 w-4 shrink-0 text-go" />
            {committed.kind === "sent"
              ? "Email sent from the Sheffield outreach mailbox."
              : `Scheduled for ${formatScheduleLong(new Date(committed.scheduledFor!))}.`}
          </p>
          <p className="mt-1.5 text-xs text-dim">
            {committed.kind === "sent"
              ? "The thread is in the inbox, with any reply that comes back."
              : "It sends automatically. Cancel it from Queued and failed below before then."}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Link
              className="inline-flex items-center gap-1.5 rounded-full bg-ink px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-ink/90"
              href={`/inbox?thread=${organisationId}`}
            >
              <Inbox aria-hidden="true" className="h-3.5 w-3.5" />
              View in inbox
              <ArrowUpRight aria-hidden="true" className="h-3.5 w-3.5" />
            </Link>
            <button
              className="inline-flex items-center gap-1.5 rounded-full border border-rule px-4 py-2 text-xs font-semibold text-lead transition-colors hover:bg-lead-wash"
              onClick={() => {
                setCommitted(null);
                setManual(false);
              }}
              type="button"
            >
              <PenLine aria-hidden="true" className="h-3.5 w-3.5" />
              Write another
            </button>
          </div>
        </div>
      )}

      {draft && !busy && (
        /* key={generation}: a regeneration updates the same outreach_messages
           row in place (F111 AC2), so draft.id cannot key this — the counter
           can, and remounting is what clears the previous draft's edits and
           un-ticks the approval box. */
        <EmailReviewPanel
          className="mt-5"
          clientAttachments={clientAttachments}
          description={
            manual
              ? "Saved as a draft. Write it, then approve below to send it from the branch mailbox."
              : "Saved as a draft. Review and edit it, then approve below to send it from the branch mailbox."
          }
          draft={draft}
          heading={manual ? "Write the email" : "Review generated draft"}
          key={generation}
          // A hand-written email had no size-tone template applied to it, so
          // there is nothing truthful to report here.
          meta={manual ? undefined : `Size tone template: ${sizeTemplateLabel(draft.sizeTemplate)}`}
          onCommitted={setCommitted}
          onDirtyChange={(state) => {
            dirty.current = state;
          }}
          onDraftCleared={() => {
            setDraft(null);
            dirty.current = null;
          }}
          onDraftSaved={({ recipient, subject, body }) => {
            // Sync the whole saved state — including the recipient (F119 AC1) —
            // so the regenerate-confirm baselines treat this draft as clean.
            setDraft((current) =>
              current ? { ...current, subject, body, savedRecipient: recipient } : current,
            );
          }}
          organisationId={organisationId}
        />
      )}
    </SectionCard>
  );
}
