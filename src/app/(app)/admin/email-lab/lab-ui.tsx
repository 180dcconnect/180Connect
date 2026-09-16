"use client";

import { Key, SectionCard } from "@/app/(app)/clients/[id]/section-card";
import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/ui/inline-alert";
import { Textarea } from "@/components/ui/textarea";
import { VIEW_ONLY_CONTROL_NOTE } from "@/lib/auth/view-only";
import type { LabPrompt } from "./actions";

/**
 * The parts both stages of the lab share: the option dials, the prompt editor,
 * and the card that reads back what the model wrote.
 *
 * They live here rather than in one stage's file because the two stages really
 * do present the same screen — a first-contact email and a follow-up differ in
 * what goes into the prompt, not in how somebody reads and edits one.
 */

/** One dial, as radio buttons: every valid answer visible, none to type. */
export function DialGroup({
  label,
  name,
  value,
  options,
  onChange,
  disabled = false,
  hint,
}: {
  label: string;
  name: string;
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
  /** For a dial the conversation has already decided — see the intent override. */
  disabled?: boolean;
  hint?: string;
}) {
  return (
    <fieldset disabled={disabled}>
      <legend className="text-sm font-medium text-ink">{label}</legend>
      {hint && <p className="mt-0.5 text-[13px] leading-[1.55] text-dim">{hint}</p>}
      <div className={`mt-2 space-y-1.5 ${disabled ? "opacity-55" : ""}`}>
        {options.map((option) => (
          <label key={option.value} className="flex items-center gap-2.5 text-sm text-dim">
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
              className="size-4 accent-lead"
            />
            <span className={value === option.value ? "text-ink" : undefined}>{option.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function PromptBox({
  id,
  label,
  hint,
  value,
  onChange,
  readOnly,
  rows,
  mono = true,
}: {
  id: string;
  label: string;
  hint: string;
  value: string;
  onChange: (value: string) => void;
  readOnly: boolean;
  rows: number;
  /** Prompts read as machine text; a pasted email reads as prose. */
  mono?: boolean;
}) {
  return (
    <div>
      <label htmlFor={id} className="text-sm font-medium text-ink">
        {label}
      </label>
      <p className="mt-0.5 text-[13px] leading-[1.55] text-dim">{hint}</p>
      <Textarea
        id={id}
        rows={rows}
        value={value}
        readOnly={readOnly}
        onChange={(event) => onChange(event.target.value)}
        className={`mt-2 rounded-inset border-rule bg-paper leading-[1.6] text-ink ${
          mono ? "font-mono text-[12.5px]" : "text-sm"
        }`}
      />
    </div>
  );
}

/**
 * The prompt editor: the two boxes, the edited-from-original warning, the reset
 * and the run button. Identical for both stages.
 */
export function PromptEditor({
  idPrefix,
  built,
  system,
  user,
  onSystemChange,
  onUserChange,
  onReset,
  onRun,
  running,
  building,
  buildError,
  runError,
  viewOnly,
  emptyMessage,
  runLabel,
  userLabel,
}: {
  idPrefix: string;
  built: LabPrompt | null;
  system: string;
  user: string;
  onSystemChange: (value: string) => void;
  onUserChange: (value: string) => void;
  onReset: () => void;
  onRun: () => void;
  running: boolean;
  building: boolean;
  buildError: string | null;
  runError: string | null;
  viewOnly: boolean;
  /** Shown before a client is chosen. */
  emptyMessage: string;
  runLabel: string;
  userLabel: string;
}) {
  const edited = built !== null && (system !== built.system || user !== built.user);

  return (
    <SectionCard
      headingId={`${idPrefix}-prompt`}
      title="What we tell the writer"
      hint="Two parts: the standing instructions, then everything about this particular email. Edit either and send it again to see the difference. Your edits stay on this screen — they are not saved and no other screen uses them."
      action={
        edited ? (
          <Button type="button" variant="outline" size="sm" onClick={onReset}>
            Start again from the current wording
          </Button>
        ) : undefined
      }
    >
      {buildError ? (
        <InlineAlert message={buildError} />
      ) : !built ? (
        <p className="text-sm leading-[1.65] text-dim">
          {building ? "Loading this client’s details…" : emptyMessage}
        </p>
      ) : (
        <div className="space-y-5">
          {edited && (
            <InlineAlert
              tone="warning"
              message="You have changed the wording. What you send below is your version, not the one the app normally uses."
            />
          )}
          <PromptBox
            id={`${idPrefix}-system`}
            label="Standing instructions"
            hint="Who we are, how we write, and the rules every email of this kind follows."
            value={system}
            onChange={onSystemChange}
            readOnly={viewOnly}
            rows={18}
          />
          <PromptBox
            id={`${idPrefix}-user`}
            label={userLabel}
            hint="Everything about this particular email, assembled from the client's record and the conversation so far."
            value={user}
            onChange={onUserChange}
            readOnly={viewOnly}
            rows={16}
          />
          {viewOnly ? (
            <p className="text-[13px] leading-[1.55] text-dim">{VIEW_ONLY_CONTROL_NOTE}</p>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" onClick={onRun} disabled={running || building}>
                {running ? "Writing…" : runLabel}
              </Button>
              <span className="text-[13px] text-dim">
                This asks the writer for a real email, which costs a small amount
                each time.
              </span>
            </div>
          )}
          {runError && <InlineAlert message={runError} />}
        </div>
      )}
    </SectionCard>
  );
}

export type NewsState =
  | { status: "idle" }
  | { status: "found"; text: string; url: string | null }
  | { status: "none" }
  | { status: "error"; message: string };

/**
 * The news-hook card, shared by both stages.
 *
 * Real generation looks a story up on its own — always for a follow-up, and for
 * a first email whenever the CAM picks the news opening. Here it is a button,
 * because the instructions rebuild every time an option changes and a lookup
 * costs a little each time.
 */
export function NewsCard({
  idPrefix,
  hint,
  news,
  onLookup,
  lookingUp,
  viewOnly,
  idleMessage,
}: {
  idPrefix: string;
  hint: string;
  news: NewsState;
  onLookup: () => void;
  lookingUp: boolean;
  viewOnly: boolean;
  idleMessage: string;
}) {
  return (
    <SectionCard
      headingId={`${idPrefix}-news`}
      title="A recent news story about them"
      hint={hint}
      action={
        viewOnly ? undefined : (
          <Button type="button" variant="outline" size="sm" onClick={onLookup} disabled={lookingUp}>
            {lookingUp ? "Looking…" : "Look for a story"}
          </Button>
        )
      }
    >
      {news.status === "idle" && <p className="text-sm leading-[1.65] text-dim">{idleMessage}</p>}
      {news.status === "none" && (
        <p className="text-sm leading-[1.65] text-dim">
          Nothing recent and relevant came back. A real email would carry on
          without one rather than invent something — which is what the
          instructions below now say.
        </p>
      )}
      {news.status === "error" && <InlineAlert message={news.message} />}
      {news.status === "found" && (
        <div className="space-y-2">
          <p className="text-sm leading-[1.65] text-ink">{news.text}</p>
          {news.url && (
            <p className="text-[13px] leading-[1.55] text-dim">
              Check it is really about this client:{" "}
              <a
                href={news.url}
                target="_blank"
                rel="noreferrer"
                className="text-lead underline underline-offset-2"
              >
                open the article
              </a>
            </p>
          )}
        </div>
      )}
      {viewOnly && (
        <p className="mt-3 text-[13px] leading-[1.55] text-dim">
          Looking up a story costs money, so it is not something a view-only
          account can start.
        </p>
      )}
    </SectionCard>
  );
}

export type LabResult = {
  subject: string | null;
  body: string;
  costUsd: number | null;
  totalTokens: number | null;
  elapsedMs: number;
};

export function ResultCard({
  idPrefix,
  hint,
  result,
}: {
  idPrefix: string;
  hint: string;
  result: LabResult;
}) {
  return (
    <SectionCard headingId={`${idPrefix}-result`} title="What it wrote" hint={hint}>
      <div className="space-y-5">
        {result.subject !== null && (
          <div>
            <Key>Subject</Key>
            <p className="mt-1 text-sm font-medium text-ink">{result.subject}</p>
          </div>
        )}
        <div>
          <Key>Message</Key>
          <p className="mt-1 text-sm leading-[1.65] whitespace-pre-wrap text-ink">{result.body}</p>
        </div>
        <dl className="grid gap-4 border-t border-rule-soft pt-4 sm:grid-cols-4">
          <Fact label="Time taken" value={`${(result.elapsedMs / 1000).toFixed(1)}s`} />
          <Fact
            label="Cost"
            value={result.costUsd == null ? "Not known" : formatUsd(result.costUsd)}
          />
          <Fact label="Length of the email" value={`${countWords(result.body)} words`} />
          <Fact
            label="Amount of text handled"
            value={
              result.totalTokens == null
                ? "Not reported"
                : `${result.totalTokens.toLocaleString("en-GB")} pieces`
            }
          />
        </dl>
      </div>
    </SectionCard>
  );
}

export function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[13px] text-dim">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium tabular-nums text-ink">{value}</dd>
    </div>
  );
}

/**
 * A single generation costs a fraction of a penny, and "$0.00" reads as free —
 * which is the one thing it must not, on a page whose whole purpose invites
 * somebody to press the button twenty times in a row.
 */
export function formatUsd(value: number): string {
  if (value === 0) return "$0.00";
  if (value < 0.01) return "less than $0.01";
  return `$${value.toFixed(2)}`;
}

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}
