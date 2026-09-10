"use client";

import * as React from "react";
import { Check, Copy, Droplets, Moon, RefreshCw, Sliders } from "lucide-react";
import { GooeyEmailInput } from "@/components/ui/gooey-email-input";
import { GooeyActionButton } from "@/components/ui/gooey-action-button";

type DarkVariant = "obsidian" | "dark" | "brand";
type SizePreset = "sm" | "md" | "lg";
type EasingName = "Bouncy" | "Smooth" | "Snappy" | "Standard";

const EASING_MAP: Record<EasingName, string> = {
  Bouncy: "cubic-bezier(0.34, 1.56, 0.64, 1)",
  Smooth: "cubic-bezier(0.3, 1.05, 0.4, 1)",
  Snappy: "cubic-bezier(0.22, 1, 0.36, 1)",
  Standard: "cubic-bezier(0.4, 0, 0.2, 1)",
};

const DEFAULTS = {
  variant: "obsidian" as DarkVariant,
  size: "md" as SizePreset,
  icon: "send" as "arrow" | "send" | "sparkles",
  gooBlur: 6,
  gooContrast: 13,
  gap: 54,
  duration: 640,
  easingName: "Standard" as EasingName,
};

/** Shared chip styling for the dark control panel. */
function chipClass(active: boolean) {
  return active
    ? "bg-[#e6f5c0] text-[#0c1014] border-[#e6f5c0] font-bold shadow-sm"
    : "bg-white/[0.03] text-[#f4f4ef]/60 border-white/[0.08] hover:bg-white/[0.08] hover:text-[#f4f4ef]";
}

function Slider({
  label,
  value,
  suffix = "",
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  suffix?: string;
  min: number;
  max: number;
  step: number;
  onChange: (n: number) => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-xs">
        <span className="text-[#f4f4ef]/60">{label}</span>
        <span className="font-mono font-bold text-[#e6f5c0]">
          {value}
          {suffix}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="h-1.5 w-full cursor-pointer rounded-lg bg-white/20 accent-[#e6f5c0]"
      />
    </div>
  );
}

/**
 * Dark counterpart to the light Interactive Email Input Playground.
 *
 * Exists so the droplet separation can be tuned against the obsidian surface
 * the invite drawer actually uses (INK_RAISED #161b21 + the single lime
 * accent) — the light playground's white stage hides how the neck reads there.
 */
export function DarkEmailPlayground() {
  const [variant, setVariant] = React.useState<DarkVariant>(DEFAULTS.variant);
  const [size, setSize] = React.useState<SizePreset>(DEFAULTS.size);
  const [icon, setIcon] = React.useState<"arrow" | "send" | "sparkles">(DEFAULTS.icon);
  const [gooBlur, setGooBlur] = React.useState(DEFAULTS.gooBlur);
  const [gooContrast, setGooContrast] = React.useState(DEFAULTS.gooContrast);
  const [gap, setGap] = React.useState(DEFAULTS.gap);
  const [duration, setDuration] = React.useState(DEFAULTS.duration);
  const [easingName, setEasingName] = React.useState<EasingName>(DEFAULTS.easingName);
  const [lastSubmitted, setLastSubmitted] = React.useState<string | null>(null);
  const [btnOpen, setBtnOpen] = React.useState(false);
  const [copied, setCopied] = React.useState(false);

  const handleReset = () => {
    setVariant(DEFAULTS.variant);
    setSize(DEFAULTS.size);
    setIcon(DEFAULTS.icon);
    setGooBlur(DEFAULTS.gooBlur);
    setGooContrast(DEFAULTS.gooContrast);
    setGap(DEFAULTS.gap);
    setDuration(DEFAULTS.duration);
    setEasingName(DEFAULTS.easingName);
  };

  const generatedCode = React.useMemo(
    () => `<GooeyEmailInput
  variant="${variant}"
  size="${size}"
  buttonIcon="${icon}"
  gooBlur={${gooBlur}}
  gooContrast={${gooContrast}}
  gap={${gap}}
  duration={${duration}}
  ease="${EASING_MAP[easingName]}"
  placeholder="Enter their work email..."
  onSubmit={(email) => sendInvite(email)}
/>`,
    [variant, size, icon, gooBlur, gooContrast, gap, duration, easingName],
  );

  const handleCopy = () => {
    navigator.clipboard.writeText(generatedCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-black/[0.06] pb-3 dark:border-white/[0.06]">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-bold tracking-tight">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#161b21] text-[#e6f5c0]">
              <Moon size={13} />
            </span>
            Interactive Email Input Playground · Dark
          </h2>
          <p className="mt-1 text-xs opacity-55">
            Same droplet budding, tuned against the obsidian sheet the invite drawer sits on. This
            stage stays dark regardless of the page Light/Dark toggle.
          </p>
        </div>
        <span className="rounded-full border border-[#e6f5c0]/30 bg-[#161b21] px-2.5 py-0.5 font-mono text-[11px] font-bold text-[#e6f5c0]">
          variant=&quot;{variant}&quot;
        </span>
      </div>

      <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-12">
        {/* Dark stage */}
        <div className="space-y-6 lg:col-span-7">
          <div className="relative flex min-h-[380px] flex-col items-center justify-center overflow-hidden rounded-3xl border border-white/[0.08] bg-[#0f1116] p-8 shadow-[0_16px_50px_-12px_rgba(0,0,0,0.6)] sm:p-14">
            {/* Lime bloom + dot grid, same treatment as the dark page shell */}
            <div className="pointer-events-none absolute -top-[30%] left-1/2 h-[320px] w-[460px] -translate-x-1/2 rounded-full bg-gradient-to-b from-[#e6f5c0]/12 via-emerald-500/5 to-transparent blur-3xl" />
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(#ffffff0d_1px,transparent_1px)] [background-size:20px_20px]" />

            <div className="absolute left-6 top-5 flex items-center gap-2 font-mono text-xs text-[#f4f4ef]/50">
              <span className="h-2 w-2 animate-pulse rounded-full bg-[#e6f5c0]" />
              Obsidian Ground (#0f1116) · Gap {gap}px · {duration}ms
            </div>

            <div className="relative z-10 my-6 flex flex-col items-center gap-7">
              <div className="flex flex-col items-center gap-2">
                <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-[#f4f4ef]/40">
                  Input · buds on focus
                </span>
                <GooeyEmailInput
                  variant={variant}
                  size={size}
                  buttonIcon={icon}
                  gooBlur={gooBlur}
                  gooContrast={gooContrast}
                  gap={gap}
                  duration={duration}
                  ease={EASING_MAP[easingName]}
                  placeholder="Enter their work email..."
                  onSubmit={(submitted) => setLastSubmitted(submitted)}
                />
              </div>

              <div className="h-px w-40 bg-white/[0.08]" />

              {/* Same group, same fill, same accent icon — the input's label
                  slot swapped for a button. This is what the invite drawer's
                  Send invitation now renders. */}
              <div className="flex flex-col items-center gap-2">
                <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-[#f4f4ef]/40">
                  Button · buds when the form is valid
                </span>
                <GooeyActionButton
                  label="Send invitation"
                  variant={variant}
                  size={size}
                  buttonIcon={icon}
                  gooBlur={gooBlur}
                  gooContrast={gooContrast}
                  gap={gap}
                  duration={duration}
                  ease={EASING_MAP[easingName]}
                  open={btnOpen}
                  onClick={() => setLastSubmitted("invite@180dc.org")}
                />
                <button
                  type="button"
                  onClick={() => setBtnOpen((v) => !v)}
                  className="rounded-full border border-white/[0.12] px-3 py-1 font-mono text-[10px] text-[#f4f4ef]/60 transition-colors hover:bg-white/10 hover:text-[#f4f4ef]"
                >
                  open={String(btnOpen)} — toggle
                </button>
              </div>
            </div>

            {lastSubmitted && (
              <div className="absolute bottom-5 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-[#e6f5c0]/30 bg-black/60 px-4 py-1.5 font-mono text-xs text-[#e6f5c0] shadow-sm">
                <Check size={13} className="text-emerald-400" /> Submitted: {lastSubmitted}
              </div>
            )}
          </div>

          {/* Generated snippet */}
          <div className="overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0f1116]">
            <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-2.5">
              <span className="flex items-center gap-1.5 font-mono text-[11px] font-bold uppercase tracking-wider text-[#f4f4ef]/50">
                <Droplets size={12} className="text-[#e6f5c0]" /> Dark usage
              </span>
              <button
                type="button"
                onClick={handleCopy}
                className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-[#f4f4ef]/50 transition-colors hover:bg-white/10 hover:text-[#f4f4ef]"
              >
                {copied ? (
                  <>
                    <Check size={11} className="text-emerald-400" /> Copied
                  </>
                ) : (
                  <>
                    <Copy size={11} /> Copy
                  </>
                )}
              </button>
            </div>
            <pre className="overflow-x-auto p-4 font-mono text-[11px] leading-relaxed text-[#f4f4ef]/80">
              {generatedCode}
            </pre>
          </div>
        </div>

        {/* Dark control panel */}
        <div className="space-y-6 rounded-3xl border border-white/[0.08] bg-[#14151b] p-6 shadow-xl sm:p-7 lg:col-span-5">
          <div className="flex items-center justify-between border-b border-white/[0.06] pb-4">
            <div className="flex items-center gap-2">
              <Sliders size={16} className="text-[#e6f5c0]" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-[#f4f4ef]/90">
                Dark Parameter Tuning
              </h3>
            </div>
            <button
              type="button"
              onClick={handleReset}
              className="flex items-center gap-1 text-[11px] font-medium text-[#f4f4ef]/40 transition-colors hover:text-[#f4f4ef]"
            >
              <RefreshCw size={11} /> Reset
            </button>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold text-[#f4f4ef]/70">Dark Pill Variant</label>
            <div className="grid grid-cols-3 gap-2">
              {(["obsidian", "dark", "brand"] as DarkVariant[]).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setVariant(v)}
                  className={`rounded-xl border py-1.5 text-xs capitalize transition-all ${chipClass(variant === v)}`}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-3.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-[#f4f4ef]">Separation Gap</span>
              <span className="rounded-md bg-[#e6f5c0]/20 px-2 py-0.5 font-mono text-xs font-bold text-[#e6f5c0]">
                {gap}px
              </span>
            </div>
            <input
              type="range"
              min="16"
              max="120"
              step="2"
              value={gap}
              onChange={(e) => setGap(parseInt(e.target.value))}
              className="h-2 w-full cursor-pointer rounded-lg bg-white/20 accent-[#e6f5c0]"
            />
            <div className="flex justify-between text-[10px] text-[#f4f4ef]/40">
              <span>Subtle (16px)</span>
              <span className="font-bold text-[#e6f5c0]">Ideal (54px)</span>
              <span>Max (120px)</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-xs font-bold text-[#f4f4ef]/70">Scale</label>
              <div className="grid grid-cols-3 gap-1.5">
                {(["sm", "md", "lg"] as SizePreset[]).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setSize(s)}
                    className={`rounded-lg border py-1 text-xs uppercase transition-all ${chipClass(size === s)}`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold text-[#f4f4ef]/70">Icon</label>
              <div className="grid grid-cols-3 gap-1.5">
                {[
                  { id: "arrow", label: "Arrow" },
                  { id: "send", label: "Send" },
                  { id: "sparkles", label: "Spark" },
                ].map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setIcon(item.id as "arrow" | "send" | "sparkles")}
                    className={`rounded-lg border py-1 text-xs transition-all ${chipClass(icon === item.id)}`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-4 border-t border-white/[0.06] pt-4">
            <Slider
              label="Goo Blur (Bridge Reach)"
              value={gooBlur}
              suffix="px"
              min={0}
              max={16}
              step={0.5}
              onChange={setGooBlur}
            />
            <Slider
              label="Alpha Contrast (Sharpness)"
              value={gooContrast}
              min={4}
              max={40}
              step={1}
              onChange={setGooContrast}
            />
            <Slider
              label="Animation Duration"
              value={duration}
              suffix="ms"
              min={120}
              max={1000}
              step={20}
              onChange={setDuration}
            />
          </div>

          <div className="space-y-2 border-t border-white/[0.06] pt-4">
            <label className="text-xs font-bold text-[#f4f4ef]/70">Easing Curve</label>
            <div className="grid grid-cols-4 gap-1.5">
              {(["Bouncy", "Smooth", "Snappy", "Standard"] as EasingName[]).map((eName) => (
                <button
                  key={eName}
                  type="button"
                  onClick={() => setEasingName(eName)}
                  className={`rounded-lg border py-1.5 text-xs transition-all ${chipClass(easingName === eName)}`}
                >
                  {eName}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
