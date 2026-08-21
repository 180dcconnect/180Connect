"use client";

import { useState, useTransition, type FormEvent } from "react";
import { Check, RotateCcw, Type, Eye, AlignLeft, Sparkles } from "lucide-react";
import { OriginButton } from "@/components/ui/origin-button";
import {
  type AccessibilitySettings,
  type FontSize,
  type ContrastMode,
  type LineSpacing,
  type ReducedMotion,
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
  DEFAULT_ACCESSIBILITY_SETTINGS,
} from "@/lib/accessibility";
import { useAccessibility } from "@/components/accessibility-provider";
import { saveAccessibilitySettingsAction, type AccessibilityFormState } from "./actions";

const FIELD_LABEL =
  "text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/40";

export function AccessibilityForm({
  initialSettings,
}: {
  initialSettings: AccessibilitySettings;
}) {
  const accessibility = useAccessibility();
  const [state, setState] = useState<AccessibilityFormState>({ status: "idle" });
  const [pending, startTransition] = useTransition();

  const [fontSize, setFontSize] = useState<FontSize>(initialSettings.fontSize);
  const [contrast, setContrast] = useState<ContrastMode>(initialSettings.contrast);
  const [lineSpacing, setLineSpacing] = useState<LineSpacing>(initialSettings.lineSpacing);
  const [reducedMotion, setReducedMotion] = useState<ReducedMotion>(initialSettings.reducedMotion);

  function handleFontSizeChange(newSize: FontSize) {
    setFontSize(newSize);
    accessibility.updateSettings({ fontSize: newSize });
  }

  function handleContrastChange(newContrast: ContrastMode) {
    setContrast(newContrast);
    accessibility.updateSettings({ contrast: newContrast });
  }

  function handleLineSpacingChange(newSpacing: LineSpacing) {
    setLineSpacing(newSpacing);
    accessibility.updateSettings({ lineSpacing: newSpacing });
  }

  function handleReducedMotionChange(newMotion: ReducedMotion) {
    setReducedMotion(newMotion);
    accessibility.updateSettings({ reducedMotion: newMotion });
  }

  function handleReset() {
    setFontSize(DEFAULT_ACCESSIBILITY_SETTINGS.fontSize);
    setContrast(DEFAULT_ACCESSIBILITY_SETTINGS.contrast);
    setLineSpacing(DEFAULT_ACCESSIBILITY_SETTINGS.lineSpacing);
    setReducedMotion(DEFAULT_ACCESSIBILITY_SETTINGS.reducedMotion);
    accessibility.resetSettings();

    const formData = new FormData();
    formData.set("fontSize", DEFAULT_ACCESSIBILITY_SETTINGS.fontSize);
    formData.set("contrast", DEFAULT_ACCESSIBILITY_SETTINGS.contrast);
    formData.set("lineSpacing", DEFAULT_ACCESSIBILITY_SETTINGS.lineSpacing);
    formData.set("reducedMotion", DEFAULT_ACCESSIBILITY_SETTINGS.reducedMotion);

    startTransition(async () => {
      const result = await saveAccessibilitySettingsAction(state, formData);
      setState(result);
    });
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData();
    formData.set("fontSize", fontSize);
    formData.set("contrast", contrast);
    formData.set("lineSpacing", lineSpacing);
    formData.set("reducedMotion", reducedMotion);

    startTransition(async () => {
      const result = await saveAccessibilitySettingsAction(state, formData);
      setState(result);
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-8" noValidate>
      {/* 1. Live Interactive Preview */}
      <section
        aria-label="Live preview"
        className="rounded-2xl border border-black/[0.08] bg-white p-6 shadow-sm space-y-4"
      >
        <div className="flex items-center justify-between border-b border-black/[0.06] pb-3">
          <div className="flex items-center gap-2">
            <Sparkles className="size-4 text-brand" aria-hidden="true" />
            <h2 className="text-xs font-bold uppercase tracking-wide text-foreground/70">
              Live Preview
            </h2>
          </div>
          <span className="text-xs text-foreground/50">
            Real-time preview of current accessibility choices
          </span>
        </div>

        <div className="space-y-3 rounded-xl bg-[#f8f9fa] p-5 border border-black/[0.04]">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-lg font-bold text-foreground">
              Empowering Social Impact
            </h3>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-brand/15 px-2.5 py-0.5 text-xs font-bold text-brand-hover">
              Active Focus
            </span>
          </div>

          <p className="text-sm leading-relaxed text-foreground/80">
            180 Degrees Consulting provides high-quality consulting services to non-profits and
            social enterprises, ensuring measurable impact across communities.
          </p>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <span className="rounded-md bg-black/5 px-2 py-1 text-xs font-medium text-foreground/75">
              Sector: Education & Youth
            </span>
            <span className="rounded-md bg-black/5 px-2 py-1 text-xs font-medium text-foreground/75">
              Location: London, UK
            </span>
          </div>
        </div>
      </section>

      {/* 2. Text Size & Scaling (F205 AC1) */}
      <section className="rounded-2xl border border-black/[0.06] bg-white p-6 shadow-sm space-y-4">
        <div className="flex items-center gap-2.5">
          <Type className="size-4 text-foreground/60" aria-hidden="true" />
          <h2 className={FIELD_LABEL}>Font Size & Text Scaling</h2>
        </div>
        <p className="text-sm text-foreground/65">
          Adjust the overall size of text, headings, data tables, and navigation across the platform.
        </p>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 pt-2">
          {FONT_SIZES.map((size) => {
            const active = fontSize === size;
            return (
              <button
                key={size}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => handleFontSizeChange(size)}
                className={`relative flex flex-col items-start rounded-xl border p-4 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
                  active
                    ? "border-brand bg-brand/5 shadow-xs"
                    : "border-black/[0.08] bg-white hover:border-black/20"
                }`}
              >
                <div className="flex w-full items-center justify-between">
                  <span
                    className={`font-bold ${
                      size === "extra-large"
                        ? "text-xl"
                        : size === "large"
                        ? "text-lg"
                        : "text-base"
                    }`}
                  >
                    Aa
                  </span>
                  {active && (
                    <span className="flex size-5 items-center justify-center rounded-full bg-brand text-white">
                      <Check className="size-3" strokeWidth={3} />
                    </span>
                  )}
                </div>
                <span className="mt-3 text-sm font-bold text-foreground">
                  {FONT_SIZE_LABELS[size]}
                </span>
                <span className="mt-1 text-xs text-foreground/60 leading-relaxed">
                  {FONT_SIZE_DESCRIPTIONS[size]}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {/* 3. Text Contrast (F205 AC1) */}
      <section className="rounded-2xl border border-black/[0.06] bg-white p-6 shadow-sm space-y-4">
        <div className="flex items-center gap-2.5">
          <Eye className="size-4 text-foreground/60" aria-hidden="true" />
          <h2 className={FIELD_LABEL}>Text & Interface Contrast</h2>
        </div>
        <p className="text-sm text-foreground/65">
          Enhance visual definition, text contrast ratios (WCAG AAA), and element boundaries.
        </p>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 pt-2">
          {CONTRAST_MODES.map((mode) => {
            const active = contrast === mode;
            return (
              <button
                key={mode}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => handleContrastChange(mode)}
                className={`relative flex flex-col items-start rounded-xl border p-4 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
                  active
                    ? "border-brand bg-brand/5 shadow-xs"
                    : "border-black/[0.08] bg-white hover:border-black/20"
                }`}
              >
                <div className="flex w-full items-center justify-between">
                  <span className="text-sm font-bold text-foreground">
                    {CONTRAST_LABELS[mode]}
                  </span>
                  {active && (
                    <span className="flex size-5 items-center justify-center rounded-full bg-brand text-white">
                      <Check className="size-3" strokeWidth={3} />
                    </span>
                  )}
                </div>
                <span className="mt-1.5 text-xs text-foreground/60 leading-relaxed">
                  {CONTRAST_DESCRIPTIONS[mode]}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {/* 4. Line Spacing & Readability */}
      <section className="rounded-2xl border border-black/[0.06] bg-white p-6 shadow-sm space-y-4">
        <div className="flex items-center gap-2.5">
          <AlignLeft className="size-4 text-foreground/60" aria-hidden="true" />
          <h2 className={FIELD_LABEL}>Line Spacing & Flow</h2>
        </div>
        <p className="text-sm text-foreground/65">
          Increase vertical line height and paragraph breathing room for comfortable scanning.
        </p>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 pt-2">
          {LINE_SPACINGS.map((spacing) => {
            const active = lineSpacing === spacing;
            return (
              <button
                key={spacing}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => handleLineSpacingChange(spacing)}
                className={`relative flex flex-col items-start rounded-xl border p-4 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
                  active
                    ? "border-brand bg-brand/5 shadow-xs"
                    : "border-black/[0.08] bg-white hover:border-black/20"
                }`}
              >
                <div className="flex w-full items-center justify-between">
                  <span className="text-sm font-bold text-foreground">
                    {LINE_SPACING_LABELS[spacing]}
                  </span>
                  {active && (
                    <span className="flex size-5 items-center justify-center rounded-full bg-brand text-white">
                      <Check className="size-3" strokeWidth={3} />
                    </span>
                  )}
                </div>
                <span className="mt-1.5 text-xs text-foreground/60 leading-relaxed">
                  {LINE_SPACING_DESCRIPTIONS[spacing]}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {/* 5. Reduced Motion */}
      <section className="rounded-2xl border border-black/[0.06] bg-white p-6 shadow-sm space-y-4">
        <h2 className={FIELD_LABEL}>Motion & Animations</h2>
        <p className="text-sm text-foreground/65">
          Control interface transitions, animated sprite loops, and hover transforms.
        </p>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 pt-2">
          {REDUCED_MOTIONS.map((motion) => {
            const active = reducedMotion === motion;
            return (
              <button
                key={motion}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => handleReducedMotionChange(motion)}
                className={`relative flex flex-col items-start rounded-xl border p-4 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
                  active
                    ? "border-brand bg-brand/5 shadow-xs"
                    : "border-black/[0.08] bg-white hover:border-black/20"
                }`}
              >
                <div className="flex w-full items-center justify-between">
                  <span className="text-sm font-bold text-foreground">
                    {REDUCED_MOTION_LABELS[motion]}
                  </span>
                  {active && (
                    <span className="flex size-5 items-center justify-center rounded-full bg-brand text-white">
                      <Check className="size-3" strokeWidth={3} />
                    </span>
                  )}
                </div>
                <span className="mt-1.5 text-xs text-foreground/60 leading-relaxed">
                  {REDUCED_MOTION_DESCRIPTIONS[motion]}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {/* 6. Form Submission & Reset */}
      <div className="flex flex-wrap items-center gap-3 pt-2">
        <OriginButton type="submit" loading={pending} disabled={pending}>
          {pending ? "Saving..." : "Save preferences"}
        </OriginButton>
        <OriginButton
          type="button"
          variant="outline"
          onClick={handleReset}
          disabled={pending}
          className="flex items-center gap-2"
        >
          <RotateCcw className="size-3.5" aria-hidden="true" />
          Reset to defaults
        </OriginButton>

        {state.status === "success" && state.message && (
          <p aria-live="polite" className="text-sm font-bold text-brand ml-2">
            {state.message}
          </p>
        )}
        {state.status === "error" && state.message && (
          <p aria-live="polite" className="text-sm font-bold text-destructive ml-2">
            {state.message}
          </p>
        )}
      </div>
    </form>
  );
}
