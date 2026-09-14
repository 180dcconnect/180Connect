"use client";

import { useEffect, useState, useTransition, type FormEvent } from "react";
import { Check, Loader2, RotateCcw, TriangleAlert } from "lucide-react";
import { Key, Pill } from "@/app/clients/[id]/section-card";
import { ShortcutList } from "@/components/keyboard-shortcut-list";
import { useAccessibility } from "@/components/accessibility-provider";
import {
  type AccessibilitySettings,
  type FontSize,
  ACCESSIBILITY_FIELDS,
  DEFAULT_ACCESSIBILITY_SETTINGS,
  sameAccessibilitySettings,
  FONT_SIZES,
  FONT_SIZE_LABELS,
  FONT_SIZE_DESCRIPTIONS,
  CONTRAST_MODES,
  CONTRAST_LABELS,
  CONTRAST_DESCRIPTIONS,
  LINE_SPACINGS,
  LINE_SPACING_LABELS,
  LINE_SPACING_DESCRIPTIONS,
  REDUCED_MOTIONS,
  REDUCED_MOTION_LABELS,
  REDUCED_MOTION_DESCRIPTIONS,
  UNDERLINE_LINKS,
  UNDERLINE_LINKS_LABELS,
  UNDERLINE_LINKS_DESCRIPTIONS,
  FOCUS_INDICATORS,
  FOCUS_INDICATOR_LABELS,
  FOCUS_INDICATOR_DESCRIPTIONS,
  STATUS_COLOURS,
  STATUS_COLOURS_LABELS,
  STATUS_COLOURS_DESCRIPTIONS,
} from "@/lib/accessibility";
import { saveAccessibilitySettingsAction, type AccessibilityFormState } from "./actions";
import { CARD, CARD_HINT, CARD_TITLE, PRIMARY_BUTTON, QUIET_BUTTON } from "../styles";
import { OptionGroup } from "../option-group";

const SAMPLE_SIZE: Record<FontSize, string> = {
  normal: "text-base",
  large: "text-lg",
  "extra-large": "text-xl",
};

/**
 * Choices are previewed, not saved.
 *
 * Picking an option shows it across the whole app straight away — that is the
 * only way to judge text size or contrast — but nothing is stored until Save.
 * Leaving the page, or Discard, puts the saved settings back. Before this,
 * every click was stored the moment it landed and Save re-stored the same
 * values, so the button did nothing and there was no way to try an option.
 */
export function AccessibilityForm() {
  const { saved, applied, preview, commit, discardPreview } = useAccessibility();
  const [state, setState] = useState<AccessibilityFormState>({ status: "idle" });
  const [pending, startTransition] = useTransition();

  const dirty = !sameAccessibilitySettings(applied, saved);
  const atDefaults = sameAccessibilitySettings(applied, DEFAULT_ACCESSIBILITY_SETTINGS);

  // Navigating away mid-preview restores what is saved. `discardPreview` has a
  // stable identity, so this cleanup runs on unmount only.
  useEffect(() => discardPreview, [discardPreview]);

  // A reload or closed tab would silently drop the preview, so ask first.
  useEffect(() => {
    if (!dirty) return;
    function onBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  function choose<K extends keyof AccessibilitySettings>(
    key: K,
    value: AccessibilitySettings[K],
  ) {
    setState({ status: "idle" });
    preview({ ...applied, [key]: value });
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData();
    for (const field of ACCESSIBILITY_FIELDS) formData.set(field.key, applied[field.key]);

    startTransition(async () => {
      const result = await saveAccessibilitySettingsAction(state, formData);
      setState(result);
      if (result.status !== "error" && result.settings) commit(result.settings);
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      {/* Preview — a slice of a real client record, in the record's own
          components, so what changes here is what changes there. */}
      <section aria-labelledby="preview-heading" className={CARD}>
        <h2 id="preview-heading" className={CARD_TITLE}>
          Preview
        </h2>
        <p className={CARD_HINT}>How a client record reads with the choices below.</p>

        <div className="mt-4 rounded-inset bg-paper px-4 py-4">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
            <Key>UK charity · 1098765</Key>
            <span className="flex flex-wrap gap-1.5">
              <Pill tone="go">Replied</Pill>
              <Pill tone="hold">Awaiting reply</Pill>
              <Pill tone="stop">Bounced</Pill>
            </span>
          </div>
          <p className="mt-2 font-body text-[18px] leading-[1.3] font-semibold tracking-[-0.01em] text-ink">
            Sheffield Youth Futures
          </p>
          <p className="mt-1.5 text-sm leading-[1.65] text-ink">
            Runs after-school mentoring and employability workshops for young people
            across South Yorkshire, with a focus on first-generation university
            applicants.
          </p>
          <p className="mt-2 text-[13.5px] text-dim">
            Education &amp; youth · Sheffield · income £412,000 ·{" "}
            <a href="#keyboard-heading" className="text-lead hover:underline">
              keyboard shortcuts
            </a>
          </p>
        </div>
      </section>

      <OptionGroup
        name="fontSize"
        title="Text size"
        hint="Scales text, spacing and controls together, across 180Connect."
        options={FONT_SIZES}
        labels={FONT_SIZE_LABELS}
        descriptions={FONT_SIZE_DESCRIPTIONS}
        value={applied.fontSize}
        onChange={(next) => choose("fontSize", next)}
        columns="sm:grid-cols-3"
        sample={(size) => (
          <span
            aria-hidden="true"
            className={`font-body leading-none font-semibold text-ink ${SAMPLE_SIZE[size]}`}
          >
            Aa
          </span>
        )}
      />

      <OptionGroup
        name="contrast"
        title="Contrast"
        hint="Darkens secondary text, borders and focus outlines."
        options={CONTRAST_MODES}
        labels={CONTRAST_LABELS}
        descriptions={CONTRAST_DESCRIPTIONS}
        value={applied.contrast}
        onChange={(next) => choose("contrast", next)}
        columns="sm:grid-cols-2"
      />

      <OptionGroup
        name="statusColours"
        title="Status colours"
        hint="The colours on status pills — replied, waiting, bounced. Every pill also has a dot and a word."
        options={STATUS_COLOURS}
        labels={STATUS_COLOURS_LABELS}
        descriptions={STATUS_COLOURS_DESCRIPTIONS}
        value={applied.statusColours}
        onChange={(next) => choose("statusColours", next)}
        columns="sm:grid-cols-2"
      />

      <OptionGroup
        name="lineSpacing"
        title="Line spacing"
        hint="More room between lines of text, for easier scanning."
        options={LINE_SPACINGS}
        labels={LINE_SPACING_LABELS}
        descriptions={LINE_SPACING_DESCRIPTIONS}
        value={applied.lineSpacing}
        onChange={(next) => choose("lineSpacing", next)}
        columns="sm:grid-cols-2"
      />

      <OptionGroup
        name="underlineLinks"
        title="Links"
        hint="How links stand out from the text around them."
        options={UNDERLINE_LINKS}
        labels={UNDERLINE_LINKS_LABELS}
        descriptions={UNDERLINE_LINKS_DESCRIPTIONS}
        value={applied.underlineLinks}
        onChange={(next) => choose("underlineLinks", next)}
        columns="sm:grid-cols-2"
      />

      <OptionGroup
        name="focusIndicator"
        title="Focus indicator"
        hint="The outline that shows where you are when moving through the page with Tab."
        options={FOCUS_INDICATORS}
        labels={FOCUS_INDICATOR_LABELS}
        descriptions={FOCUS_INDICATOR_DESCRIPTIONS}
        value={applied.focusIndicator}
        onChange={(next) => choose("focusIndicator", next)}
        columns="sm:grid-cols-2"
      />

      <OptionGroup
        name="reducedMotion"
        title="Motion"
        hint="Page entrances, transitions, hover movement and loading animations."
        options={REDUCED_MOTIONS}
        labels={REDUCED_MOTION_LABELS}
        descriptions={REDUCED_MOTION_DESCRIPTIONS}
        value={applied.reducedMotion}
        onChange={(next) => choose("reducedMotion", next)}
        columns="sm:grid-cols-3"
      />

      <section aria-labelledby="keyboard-heading" className={CARD}>
        <h2 id="keyboard-heading" className={CARD_TITLE}>
          Keyboard
        </h2>
        <p className={CARD_HINT}>
          The shortcuts 180Connect has today. Press ? anywhere to open this list.
        </p>
        <div className="mt-4 border-t border-rule-soft pt-4">
          <ShortcutList />
        </div>
      </section>

      {/* The save bar follows the reader down the page — with seven cards, a
          Save button at the bottom is out of sight while previewing text size
          at the top. */}
      {(dirty || state.status !== "idle") && (
        <div className="sticky bottom-4 z-10 mx-auto flex w-full flex-wrap items-center gap-x-3 gap-y-2 rounded-panel border border-rule bg-white px-4 py-3 sm:w-1/2">
          <p aria-live="polite" className="mr-auto flex items-center gap-2 text-[13px]">
            {state.status === "error" ? (
              <span className="font-semibold text-stop">{state.message}</span>
            ) : state.status === "partial" ? (
              <span className="flex items-center gap-1.5 font-semibold text-hold">
                <TriangleAlert aria-hidden="true" className="size-3.5 shrink-0" strokeWidth={2.2} />
                {state.message}
              </span>
            ) : dirty ? (
              <span className="flex items-center gap-2 text-ink">
                <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-hold" />
                Previewing changes — not saved yet
              </span>
            ) : (
              <span className="flex items-center gap-1.5 font-semibold text-go">
                <Check aria-hidden="true" className="size-3.5 shrink-0" strokeWidth={2.5} />
                {state.message}
              </span>
            )}
          </p>

          <button
            type="button"
            onClick={() => {
              setState({ status: "idle" });
              preview(DEFAULT_ACCESSIBILITY_SETTINGS);
            }}
            disabled={pending || atDefaults}
            className={QUIET_BUTTON}
          >
            <RotateCcw className="size-3.5" aria-hidden="true" />
            Reset to defaults
          </button>
          {dirty && (
            <button
              type="button"
              onClick={() => {
                setState({ status: "idle" });
                discardPreview();
              }}
              disabled={pending}
              className={QUIET_BUTTON}
            >
              Discard
            </button>
          )}
          <button
            type="submit"
            disabled={pending || !dirty}
            aria-busy={pending || undefined}
            className={PRIMARY_BUTTON}
          >
            {pending && <Loader2 className="size-3.5 animate-spin" strokeWidth={2.2} />}
            {pending ? "Saving…" : "Save"}
          </button>
        </div>
      )}
    </form>
  );
}
