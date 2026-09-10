"use client";

import * as React from "react";
import {
  Check,
  Copy,
  Sliders,
  Code2,
  Droplets,
  Layers,
  Zap,
  RefreshCw,
  Plus,
  FileText,
  Image as ImageIcon,
  FolderPlus,
  Sun,
  Moon,
  Sparkles,
  RotateCcw,
} from "lucide-react";
import { Liquid } from "liquid-gooey";
import { GooeyEmailInput } from "@/components/ui/gooey-email-input";
import { BrandCta } from "@/components/brand/brand-cta";
import { GooeyBrandCta } from "@/components/brand/gooey-brand-cta";
import { BackButton } from "@/components/ui/back-button";
import { DarkEmailPlayground } from "./dark-email-playground";

type ThemeVariant = "light" | "brand" | "dark" | "glass";
type SizePreset = "sm" | "md" | "lg";
type EasingName = "Bouncy" | "Smooth" | "Snappy" | "Standard";

const EASING_MAP: Record<EasingName, string> = {
  Bouncy: "cubic-bezier(0.34, 1.56, 0.64, 1)",
  Smooth: "cubic-bezier(0.3, 1.05, 0.4, 1)",
  Snappy: "cubic-bezier(0.22, 1, 0.36, 1)",
  Standard: "cubic-bezier(0.4, 0, 0.2, 1)",
};

export default function PreviewGooeyPage() {
  // Page color mode (defaults to Light)
  const [pageTheme, setPageTheme] = React.useState<"light" | "dark">("light");

  // State for Landing CTA Replay Animation
  const [landingCtaKey, setLandingCtaKey] = React.useState(0);
  const [landingCtaFeedback, setLandingCtaFeedback] = React.useState<string | null>(null);

  // Playground state for Email Input
  const [variant, setVariant] = React.useState<ThemeVariant>("light");
  const [size, setSize] = React.useState<SizePreset>("md");
  const [icon, setIcon] = React.useState<"arrow" | "send" | "sparkles">("arrow");
  const [gooBlur, setGooBlur] = React.useState<number>(6);
  const [gooContrast, setGooContrast] = React.useState<number>(14);
  const [gap, setGap] = React.useState<number>(54); // Perfect separation gap 54px
  const [duration, setDuration] = React.useState<number>(640);
  const [easingName, setEasingName] = React.useState<EasingName>("Standard");
  const [copiedCode, setCopiedCode] = React.useState(false);
  const [lastSubmittedEmail, setLastSubmittedEmail] = React.useState<string | null>(null);

  // Secondary demo states: Plus Menu
  const [menuOpen, setMenuOpen] = React.useState(false);

  // Secondary demo states: Gooey Tabs
  const [activeTab, setActiveTab] = React.useState<number>(0);
  const tabsList = ["Overview", "Analytics", "Settings", "Activity"];

  const handleResetControls = () => {
    setVariant("light");
    setSize("md");
    setIcon("arrow");
    setGooBlur(6);
    setGooContrast(13);
    setGap(54);
    setDuration(640);
    setEasingName("Standard");
  };

  const handleReplayLandingAnimation = () => {
    setLandingCtaKey((prev) => prev + 1);
    setLandingCtaFeedback("Playing entrance: button droplet emerges on load...");
    setTimeout(() => setLandingCtaFeedback(null), 3000);
  };

  const generatedCode = React.useMemo(() => {
    return `import { GooeyEmailInput } from "@/components/ui/gooey-email-input";
import { GooeyBrandCta } from "@/components/brand/gooey-brand-cta";

// 1. Landing Page 'Get Started' Liquid Emergence:
export function HeroCta() {
  return (
    <GooeyBrandCta
      label="Get Started"
      gap={76}
      gooBlur={6}
      gooContrast={13}
      duration={640}
      ease="cubic-bezier(0.4, 0, 0.2, 1)"
      entranceDelay={400}
      onClick={() => console.log("Sign in triggered")}
    />
  );
}

// 2. Email Input with Budding Submit Droplet:
export function NewsletterSignup() {
  return (
    <GooeyEmailInput
      variant="${variant}"
      size="${size}"
      buttonIcon="${icon}"
      gooBlur={${gooBlur}}
      gooContrast={${gooContrast}}
      gap={${gap}}
      duration={${duration}}
      ease="${EASING_MAP[easingName]}"
      placeholder="Enter your work email..."
      onSubmit={(email) => console.log("Subscribed:", email)}
    />
  );
}`;
  }, [variant, size, icon, gooBlur, gooContrast, gap, duration, easingName]);

  const handleCopyCode = () => {
    navigator.clipboard.writeText(generatedCode);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const isDarkPage = pageTheme === "dark";

  return (
    <div
      className={`min-h-screen transition-colors duration-300 ${
        isDarkPage
          ? "bg-[#0c0d11] text-[#f5f5f0] selection:bg-[#e6f5c0] selection:text-black"
          : "bg-[#f5f5f0] text-[#17181c] selection:bg-[#17181c] selection:text-[#f5f5f0]"
      }`}
    >
      {/* Subtle Background Glows */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        {isDarkPage ? (
          <>
            <div className="absolute -top-[20%] left-1/2 -translate-x-1/2 w-[700px] h-[500px] bg-gradient-to-b from-[#e6f5c0]/10 via-emerald-500/5 to-transparent blur-3xl opacity-70 rounded-full" />
            <div className="absolute top-[45%] -left-[10%] w-[500px] h-[500px] bg-emerald-500/5 blur-3xl rounded-full" />
          </>
        ) : (
          <>
            <div className="absolute -top-[10%] left-1/2 -translate-x-1/2 w-[650px] h-[450px] bg-gradient-to-b from-[#e6f5c0]/35 via-emerald-100/25 to-transparent blur-3xl opacity-80 rounded-full" />
            <div className="absolute top-[35%] -left-[10%] w-[500px] h-[500px] bg-slate-200/40 blur-3xl rounded-full" />
            <div className="absolute top-[60%] -right-[10%] w-[500px] h-[500px] bg-[#e6f5c0]/20 blur-3xl rounded-full" />
          </>
        )}
      </div>

      <div className="relative mx-auto w-full max-w-6xl px-6 py-10 sm:px-10 sm:py-12 space-y-12">
        {/* Top Header & Page Navigation */}
        <header
          className={`flex flex-wrap items-center justify-between gap-4 border-b pb-6 ${
            isDarkPage ? "border-white/[0.08]" : "border-black/[0.08]"
          }`}
        >
          <div className="space-y-1.5">
            <div className="flex items-center gap-2.5">
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-[0.12em] border ${
                  isDarkPage
                    ? "bg-[#e6f5c0]/15 text-[#e6f5c0] border-[#e6f5c0]/30"
                    : "bg-[#17181c] text-[#e6f5c0] border-[#17181c]"
                }`}
              >
                <Droplets size={12} className="text-[#e6f5c0]" /> Liquid UI
              </span>
              <span
                className={`text-xs font-mono ${
                  isDarkPage ? "text-white/40" : "text-black/40"
                }`}
              >
                liquid-gooey @ v0.2.1
              </span>
            </div>
            <h1
              className={`text-3xl sm:text-4xl font-black tracking-[-0.03em] ${
                isDarkPage ? "text-white" : "text-[#17181c]"
              }`}
            >
              Liquid Gooey Interactions
            </h1>
            <p
              className={`text-sm max-w-xl ${
                isDarkPage ? "text-white/60" : "text-black/60"
              }`}
            >
              Organic droplet budding, liquid necking &amp; wide separation animation powered by SVG alpha
              thresholding.
            </p>
          </div>

          <div className="flex items-center gap-3">
            {/* Theme Toggle Button */}
            <button
              type="button"
              onClick={() => setPageTheme(isDarkPage ? "light" : "dark")}
              className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-semibold border transition-all ${
                isDarkPage
                  ? "bg-white/10 text-white border-white/20 hover:bg-white/15"
                  : "bg-white text-neutral-800 border-black/[0.08] shadow-sm hover:bg-neutral-50"
              }`}
            >
              {isDarkPage ? (
                <>
                  <Sun size={14} className="text-[#e6f5c0]" /> Light View
                </>
              ) : (
                <>
                  <Moon size={14} className="text-neutral-600" /> Dark View
                </>
              )}
            </button>

            <BackButton
              variant="sliding-door"
              size="sm"
              tone={isDarkPage ? "glass" : "bone"}
              label="Dashboard"
              href="/dashboard"
            />
          </div>
        </header>

        {/* 🌟 FEATURED EXPERIMENT: LANDING PAGE "GET STARTED" LIQUID BUDDING */}
        <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#e6f5c0] text-black">
                <Sparkles size={14} />
              </span>
              <div>
                <h2
                  className={`text-lg font-bold tracking-tight ${
                    isDarkPage ? "text-white" : "text-neutral-900"
                  }`}
                >
                  Featured Concept: Landing Page &quot;Get Started&quot; Liquid Emergence
                </h2>
                <p
                  className={`text-xs ${
                    isDarkPage ? "text-white/50" : "text-neutral-500"
                  }`}
                >
                  Starts as a single capsule. On page entrance, the right arrow disc emerges from the Get Started button like a viscous liquid droplet.
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={handleReplayLandingAnimation}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all shadow-sm ${
                isDarkPage
                  ? "bg-[#e6f5c0] text-black hover:bg-[#d8ecab]"
                  : "bg-[#17181c] text-[#e6f5c0] hover:bg-black"
              }`}
            >
              <RotateCcw size={14} /> Replay Entrance Animation
            </button>
          </div>

          <div
            className="relative rounded-3xl border overflow-hidden p-8 sm:p-14 flex flex-col items-center justify-center min-h-[360px] bg-[#f4f4ef] border-black/[0.08] shadow-[0_4px_24px_-4px_rgba(0,0,0,0.06),0_12px_40px_-8px_rgba(0,0,0,0.08)]"
          >
            {/* Subtle Grid Canvas Background */}
            <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(#0000000a_1px,transparent_1px)] [background-size:20px_20px]" />

            {/* Status Note */}
            <div className="absolute top-5 left-6 flex items-center gap-2 text-xs font-mono text-neutral-600">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
              180Connect Landing Page Ground (#f4f4ef) · Authentic Glass + Lime Palette
            </div>

            {/* Showcase with side-by-side verification */}
            <div className="relative z-10 my-8 flex flex-col sm:flex-row items-center gap-10 sm:gap-16">
              {/* 1. Animated Emergence Instance */}
              <div className="flex flex-col items-center gap-3">
                <span className="text-[11px] font-bold uppercase tracking-wider text-neutral-500 font-mono">
                  Gooey Emergence on Load
                </span>
                <GooeyBrandCta
                  key={landingCtaKey}
                  label="Get Started"
                  size="lg"
                  entranceDelay={250}
                  duration={640}
                  gooBlur={6}
                  gooContrast={13}
                  onClick={() => {
                    setLandingCtaFeedback("Clicked 'Get Started' → Sign In Modal");
                    setTimeout(() => setLandingCtaFeedback(null), 2500);
                  }}
                />
              </div>

              <div className="hidden sm:block w-px h-16 bg-black/[0.08]" />

              {/* 2. Static Reference Instance */}
              <div className="flex flex-col items-center gap-3">
                <span className="text-[11px] font-bold uppercase tracking-wider text-neutral-500 font-mono">
                  Landing Reference (At Rest)
                </span>
                <BrandCta
                  href="#"
                  label="Get Started"
                  size="lg"
                  onClick={() => {}}
                />
              </div>
            </div>

            {/* Bottom Status / Feedback Toast */}
            {landingCtaFeedback ? (
              <div className="absolute bottom-5 left-1/2 -translate-x-1/2 text-xs font-mono flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-[#0c1014] text-[#e6f5c0] border border-[#0c1014] shadow-sm animate-in fade-in duration-200">
                <Check size={13} className="text-emerald-400" /> {landingCtaFeedback}
              </div>
            ) : (
              <div className="absolute bottom-5 text-[11px] font-mono text-neutral-500">
                Starts as single &apos;Get Started&apos; capsule → arrow disc emerges organically and settles at exact tangent point.
              </div>
            )}
          </div>
        </section>

        {/* SECTION 2: THE GOOEY EMAIL INPUT PLAYGROUND */}
        <section className="space-y-4">
          <div className="border-b border-black/[0.06] dark:border-white/[0.06] pb-3">
            <h2
              className={`text-xl font-bold tracking-tight ${
                isDarkPage ? "text-white" : "text-neutral-900"
              }`}
            >
              Interactive Email Input Playground
            </h2>
            <p
              className={`text-xs ${
                isDarkPage ? "text-white/50" : "text-neutral-500"
              }`}
            >
              Click inside the field to watch the submit button droplet bud out with liquid surface tension.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
            {/* Main Interactive Stage Preview (7 cols) */}
            <div className="lg:col-span-7 space-y-6">
              <div
                className={`relative rounded-3xl border overflow-hidden p-8 sm:p-14 flex flex-col items-center justify-center min-h-[380px] transition-colors ${
                  isDarkPage
                    ? "bg-[#14151b] border-white/[0.08] shadow-2xl"
                    : "bg-white border-black/[0.07] shadow-[0_4px_24px_-4px_rgba(0,0,0,0.06),0_12px_40px_-8px_rgba(0,0,0,0.08)]"
                }`}
              >
                {/* Subtle Grid Canvas Background */}
                <div
                  className={`absolute inset-0 pointer-events-none [background-size:20px_20px] ${
                    isDarkPage
                      ? "bg-[radial-gradient(#ffffff0a_1px,transparent_1px)]"
                      : "bg-[radial-gradient(#00000008_1px,transparent_1px)]"
                  }`}
                />

                {/* Status Header inside Stage */}
                <div
                  className={`absolute top-5 left-6 flex items-center gap-2 text-xs font-mono ${
                    isDarkPage ? "text-white/50" : "text-black/50"
                  }`}
                >
                  <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                  Live Input: Separation Gap {gap}px · Duration {duration}ms
                </div>

                {/* The Featured Gooey Input Instance */}
                <div className="relative z-10 my-8">
                  <GooeyEmailInput
                    variant={variant}
                    size={size}
                    buttonIcon={icon}
                    gooBlur={gooBlur}
                    gooContrast={gooContrast}
                    gap={gap}
                    duration={duration}
                    ease={EASING_MAP[easingName]}
                    placeholder="Enter your email address..."
                    onSubmit={(submitted) => {
                      setLastSubmittedEmail(submitted);
                    }}
                  />
                </div>

                {/* Bottom Notification if submitted */}
                {lastSubmittedEmail && (
                  <div
                    className={`absolute bottom-5 left-1/2 -translate-x-1/2 text-xs font-mono flex items-center gap-1.5 px-4 py-1.5 rounded-full border shadow-sm ${
                      isDarkPage
                        ? "bg-black/60 text-[#e6f5c0] border-[#e6f5c0]/30"
                        : "bg-[#17181c] text-[#e6f5c0] border-[#17181c]"
                    }`}
                  >
                    <Check size={13} className="text-emerald-400" /> Submitted: {lastSubmittedEmail}
                  </div>
                )}
              </div>

              {/* Quick Feature Pillars */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div
                  className={`rounded-2xl border p-4 space-y-1.5 transition-colors ${
                    isDarkPage
                      ? "bg-[#14151b]/70 border-white/[0.06]"
                      : "bg-white border-black/[0.06] shadow-sm"
                  }`}
                >
                  <div
                    className={`flex items-center gap-1.5 text-xs font-bold ${
                      isDarkPage ? "text-[#e6f5c0]" : "text-neutral-900"
                    }`}
                  >
                    <Droplets size={14} className="text-emerald-600" /> Wide Separation
                  </div>
                  <p
                    className={`text-[11px] leading-relaxed ${
                      isDarkPage ? "text-white/50" : "text-neutral-600"
                    }`}
                  >
                    Separates outward by {gap}px with organic necking, forming a distinct satellite droplet.
                  </p>
                </div>

                <div
                  className={`rounded-2xl border p-4 space-y-1.5 transition-colors ${
                    isDarkPage
                      ? "bg-[#14151b]/70 border-white/[0.06]"
                      : "bg-white border-black/[0.06] shadow-sm"
                  }`}
                >
                  <div
                    className={`flex items-center gap-1.5 text-xs font-bold ${
                      isDarkPage ? "text-[#e6f5c0]" : "text-neutral-900"
                    }`}
                  >
                    <Zap size={14} className="text-amber-500" /> Alpha-Contrast Snap
                  </div>
                  <p
                    className={`text-[11px] leading-relaxed ${
                      isDarkPage ? "text-white/50" : "text-neutral-600"
                    }`}
                  >
                    SVG color matrix snaps blurred edges into a clean liquid bridge before pinching off cleanly.
                  </p>
                </div>

                <div
                  className={`rounded-2xl border p-4 space-y-1.5 transition-colors ${
                    isDarkPage
                      ? "bg-[#14151b]/70 border-white/[0.06]"
                      : "bg-white border-black/[0.06] shadow-sm"
                  }`}
                >
                  <div
                    className={`flex items-center gap-1.5 text-xs font-bold ${
                      isDarkPage ? "text-[#e6f5c0]" : "text-neutral-900"
                    }`}
                  >
                    <Layers size={14} className="text-blue-500" /> Crisp Un-blurred UI
                  </div>
                  <p
                    className={`text-[11px] leading-relaxed ${
                      isDarkPage ? "text-white/50" : "text-neutral-600"
                    }`}
                  >
                    Only the background silhouette layer receives the SVG filter. The input text and icons stay sharp.
                  </p>
                </div>
              </div>
            </div>

            {/* Control Station Panel (5 cols) */}
            <div
              className={`lg:col-span-5 rounded-3xl border p-6 sm:p-7 space-y-6 transition-colors ${
                isDarkPage
                  ? "bg-[#14151b] border-white/[0.08] shadow-xl"
                  : "bg-white border-black/[0.07] shadow-[0_4px_20px_-4px_rgba(0,0,0,0.06)]"
              }`}
            >
              <div
                className={`flex items-center justify-between border-b pb-4 ${
                  isDarkPage ? "border-white/[0.06]" : "border-black/[0.06]"
                }`}
              >
                <div className="flex items-center gap-2">
                  <Sliders
                    size={16}
                    className={isDarkPage ? "text-[#e6f5c0]" : "text-neutral-900"}
                  />
                  <h3
                    className={`text-xs font-bold tracking-wider uppercase ${
                      isDarkPage ? "text-white/90" : "text-neutral-900"
                    }`}
                  >
                    Live Parameter Tuning
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={handleResetControls}
                  className={`flex items-center gap-1 text-[11px] font-medium transition-colors ${
                    isDarkPage
                      ? "text-white/40 hover:text-white"
                      : "text-neutral-500 hover:text-neutral-900"
                  }`}
                >
                  <RefreshCw size={11} /> Reset
                </button>
              </div>

              {/* Theme Variant Switcher */}
              <div className="space-y-2">
                <label
                  className={`text-xs font-bold ${
                    isDarkPage ? "text-white/70" : "text-neutral-700"
                  }`}
                >
                  Pill Variant
                </label>
                <div className="grid grid-cols-4 gap-2">
                  {(["light", "brand", "dark", "glass"] as ThemeVariant[]).map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setVariant(v)}
                      className={`py-1.5 text-xs font-medium rounded-xl capitalize border transition-all ${
                        variant === v
                          ? isDarkPage
                            ? "bg-[#e6f5c0] text-black border-[#e6f5c0] font-bold shadow-sm"
                            : "bg-[#17181c] text-white border-[#17181c] font-bold shadow-sm"
                          : isDarkPage
                          ? "bg-white/[0.03] text-white/60 border-white/[0.08] hover:bg-white/[0.08] hover:text-white"
                          : "bg-neutral-100 text-neutral-600 border-black/[0.04] hover:bg-neutral-200/70 hover:text-black"
                      }`}
                    >
                      {v}
                    </button>
                  ))}
                </div>
              </div>

              {/* Separation Gap Slider */}
              <div
                className={`space-y-2 p-3.5 rounded-2xl border ${
                  isDarkPage
                    ? "bg-white/[0.03] border-white/[0.08]"
                    : "bg-neutral-50 border-black/[0.06]"
                }`}
              >
                <div className="flex justify-between items-center text-xs">
                  <span
                    className={`font-bold ${
                      isDarkPage ? "text-white" : "text-neutral-900"
                    }`}
                  >
                    Separation Gap
                  </span>
                  <span
                    className={`font-mono font-bold px-2 py-0.5 rounded-md text-xs ${
                      isDarkPage
                        ? "bg-[#e6f5c0]/20 text-[#e6f5c0]"
                        : "bg-[#17181c] text-[#e6f5c0]"
                    }`}
                  >
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
                  className="w-full accent-neutral-900 bg-neutral-300 dark:bg-white/20 rounded-lg h-2 cursor-pointer"
                />
                <div
                  className={`flex justify-between text-[10px] ${
                    isDarkPage ? "text-white/40" : "text-neutral-500"
                  }`}
                >
                  <span>Subtle (16px)</span>
                  <span className="font-bold text-neutral-900 dark:text-[#e6f5c0]">Ideal (76px)</span>
                  <span>Max (120px)</span>
                </div>
              </div>

              {/* Size & Icon Pickers */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label
                    className={`text-xs font-bold ${
                      isDarkPage ? "text-white/70" : "text-neutral-700"
                    }`}
                  >
                    Scale
                  </label>
                  <div className="grid grid-cols-3 gap-1.5">
                    {(["sm", "md", "lg"] as SizePreset[]).map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setSize(s)}
                        className={`py-1 text-xs uppercase font-medium rounded-lg border transition-all ${
                          size === s
                            ? isDarkPage
                              ? "bg-white/20 text-white border-white/30 font-bold"
                              : "bg-neutral-900 text-white border-neutral-900 font-bold"
                            : isDarkPage
                            ? "bg-white/[0.03] text-white/50 border-white/[0.06] hover:bg-white/[0.08]"
                            : "bg-neutral-100 text-neutral-600 border-black/[0.04] hover:bg-neutral-200/70"
                        }`}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <label
                    className={`text-xs font-bold ${
                      isDarkPage ? "text-white/70" : "text-neutral-700"
                    }`}
                  >
                    Icon
                  </label>
                  <div className="grid grid-cols-3 gap-1.5">
                    {[
                      { id: "arrow", label: "Arrow" },
                      { id: "send", label: "Send" },
                      { id: "sparkles", label: "Sparkle" },
                    ].map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => setIcon(item.id as "arrow" | "send" | "sparkles")}
                        className={`py-1 text-xs font-medium rounded-lg border transition-all ${
                          icon === item.id
                            ? isDarkPage
                              ? "bg-white/20 text-white border-white/30 font-bold"
                              : "bg-neutral-900 text-white border-neutral-900 font-bold"
                            : isDarkPage
                            ? "bg-white/[0.03] text-white/50 border-white/[0.06] hover:bg-white/[0.08]"
                            : "bg-neutral-100 text-neutral-600 border-black/[0.04] hover:bg-neutral-200/70"
                        }`}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Goo Physics Sliders */}
              <div
                className={`space-y-4 pt-4 border-t ${
                  isDarkPage ? "border-white/[0.06]" : "border-black/[0.06]"
                }`}
              >
                {/* Goo Blur */}
                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs">
                    <span
                      className={isDarkPage ? "text-white/60" : "text-neutral-600"}
                    >
                      Goo Blur (Bridge Reach)
                    </span>
                    <span
                      className={`font-mono font-bold ${
                        isDarkPage ? "text-[#e6f5c0]" : "text-neutral-900"
                      }`}
                    >
                      {gooBlur}px
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="16"
                    step="0.5"
                    value={gooBlur}
                    onChange={(e) => setGooBlur(parseFloat(e.target.value))}
                    className="w-full accent-neutral-900 bg-neutral-300 dark:bg-white/20 rounded-lg h-1.5 cursor-pointer"
                  />
                </div>

                {/* Goo Contrast */}
                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs">
                    <span
                      className={isDarkPage ? "text-white/60" : "text-neutral-600"}
                    >
                      Alpha Contrast (Sharpness)
                    </span>
                    <span
                      className={`font-mono font-bold ${
                        isDarkPage ? "text-[#e6f5c0]" : "text-neutral-900"
                      }`}
                    >
                      {gooContrast}
                    </span>
                  </div>
                  <input
                    type="range"
                    min="4"
                    max="40"
                    step="1"
                    value={gooContrast}
                    onChange={(e) => setGooContrast(parseInt(e.target.value))}
                    className="w-full accent-neutral-900 bg-neutral-300 dark:bg-white/20 rounded-lg h-1.5 cursor-pointer"
                  />
                </div>

                {/* Duration */}
                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs">
                    <span
                      className={isDarkPage ? "text-white/60" : "text-neutral-600"}
                    >
                      Animation Duration
                    </span>
                    <span
                      className={`font-mono font-bold ${
                        isDarkPage ? "text-[#e6f5c0]" : "text-neutral-900"
                      }`}
                    >
                      {duration}ms
                    </span>
                  </div>
                  <input
                    type="range"
                    min="120"
                    max="1000"
                    step="20"
                    value={duration}
                    onChange={(e) => setDuration(parseInt(e.target.value))}
                    className="w-full accent-neutral-900 bg-neutral-300 dark:bg-white/20 rounded-lg h-1.5 cursor-pointer"
                  />
                </div>
              </div>

              {/* Easing Curve Picker */}
              <div
                className={`space-y-2 pt-4 border-t ${
                  isDarkPage ? "border-white/[0.06]" : "border-black/[0.06]"
                }`}
              >
                <label
                  className={`text-xs font-bold ${
                    isDarkPage ? "text-white/70" : "text-neutral-700"
                  }`}
                >
                  Easing Curve
                </label>
                <div className="grid grid-cols-4 gap-1.5">
                  {(["Bouncy", "Smooth", "Snappy", "Standard"] as EasingName[]).map((eName) => (
                    <button
                      key={eName}
                      type="button"
                      onClick={() => setEasingName(eName)}
                      className={`py-1.5 text-xs font-medium rounded-lg border transition-all ${
                        easingName === eName
                          ? isDarkPage
                            ? "bg-[#e6f5c0]/20 text-[#e6f5c0] border-[#e6f5c0]/50 font-bold"
                            : "bg-neutral-900 text-white border-neutral-900 font-bold"
                          : isDarkPage
                          ? "bg-white/[0.03] text-white/50 border-white/[0.06] hover:bg-white/[0.08]"
                          : "bg-neutral-100 text-neutral-600 border-black/[0.04] hover:bg-neutral-200/70"
                      }`}
                    >
                      {eName}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* SECTION 2b: THE SAME PLAYGROUND, TUNED ON THE OBSIDIAN SHEET */}
        <DarkEmailPlayground />

        {/* Other Liquid Effects from the Library (Gooey Tabs & Plus Menu in Light Mode) */}
        <section className="space-y-6">
          <div
            className={`border-b pb-3 ${
              isDarkPage ? "border-white/[0.08]" : "border-black/[0.08]"
            }`}
          >
            <h2
              className={`text-xl font-bold tracking-tight ${
                isDarkPage ? "text-white" : "text-neutral-900"
              }`}
            >
              Additional Liquid Gooey Effects
            </h2>
            <p
              className={`text-xs ${
                isDarkPage ? "text-white/50" : "text-neutral-500"
              }`}
            >
              Demonstrating <code>effect=&quot;move&quot;</code> (rubber trail) and satellite morphing.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Gooey Tabs with Rubber Droplet Trail */}
            <div
              className={`rounded-3xl border p-6 sm:p-8 flex flex-col items-center justify-between min-h-[300px] transition-colors ${
                isDarkPage
                  ? "bg-[#14151b] border-white/[0.08]"
                  : "bg-white border-black/[0.07] shadow-sm"
              }`}
            >
              <div
                className={`w-full flex items-center justify-between text-xs mb-2 ${
                  isDarkPage ? "text-white/50" : "text-neutral-600"
                }`}
              >
                <span className="font-bold text-neutral-900 dark:text-white">Gooey Tabs</span>
                <span className="font-mono text-[11px] bg-neutral-100 dark:bg-white/10 px-2 py-0.5 rounded-full">
                  effect=&quot;move&quot;
                </span>
              </div>
              <div className="my-auto py-6 flex flex-col items-center gap-4">
                <Liquid
                  blur={5}
                  contrast={18}
                  fill={isDarkPage ? "#ffffff" : "#17181c"}
                  shadow={isDarkPage ? "0 2px 8px rgba(0,0,0,0.3)" : "0 2px 8px rgba(0,0,0,0.15)"}
                  className={`relative inline-flex items-center gap-1 p-1 rounded-full border ${
                    isDarkPage
                      ? "bg-white/[0.06] border-white/[0.08]"
                      : "bg-neutral-100 border-black/[0.06]"
                  }`}
                >
                  <Liquid.Item
                    effect="move"
                    move={{ springiness: 0.6, trail: 0.5, stretch: 0.25 }}
                  >
                    <div
                      className={`absolute top-1 bottom-1 h-8 rounded-full transition-all duration-300 pointer-events-none ${
                        isDarkPage ? "bg-white" : "bg-[#17181c]"
                      }`}
                      style={{
                        width: "80px",
                        transform: `translateX(${activeTab * 84}px)`,
                      }}
                    />
                  </Liquid.Item>

                  <div className="relative z-10 flex items-center">
                    {tabsList.map((tab, idx) => (
                      <button
                        key={tab}
                        type="button"
                        onClick={() => setActiveTab(idx)}
                        className={`w-[84px] h-8 text-xs font-semibold rounded-full transition-colors duration-200 ${
                          activeTab === idx
                            ? isDarkPage
                              ? "text-neutral-900 font-bold"
                              : "text-white font-bold"
                            : isDarkPage
                            ? "text-white/60 hover:text-white"
                            : "text-neutral-600 hover:text-neutral-900"
                        }`}
                      >
                        {tab}
                      </button>
                    ))}
                  </div>
                </Liquid>
              </div>
              <p
                className={`text-[11px] text-center ${
                  isDarkPage ? "text-white/40" : "text-neutral-500"
                }`}
              >
                Click different tabs — the indicator trails behind with viscous rubber tension.
              </p>
            </div>

            {/* Satellite Plus Menu */}
            <div
              className={`rounded-3xl border p-6 sm:p-8 flex flex-col items-center justify-between min-h-[300px] transition-colors ${
                isDarkPage
                  ? "bg-[#14151b] border-white/[0.08]"
                  : "bg-white border-black/[0.07] shadow-sm"
              }`}
            >
              <div
                className={`w-full flex items-center justify-between text-xs mb-2 ${
                  isDarkPage ? "text-white/50" : "text-neutral-600"
                }`}
              >
                <span className="font-bold text-neutral-900 dark:text-white">Satellite Plus Menu</span>
                <span className="font-mono text-[11px] bg-neutral-100 dark:bg-white/10 px-2 py-0.5 rounded-full">
                  effect=&quot;morph&quot;
                </span>
              </div>
              <div className="my-auto py-6 flex items-center justify-center relative w-full h-[140px]">
                <Liquid
                  blur={6}
                  contrast={18}
                  fill={isDarkPage ? "#ffffff" : "#17181c"}
                  shadow={isDarkPage ? "0 4px 16px rgba(0,0,0,0.35)" : "0 4px 16px rgba(0,0,0,0.18)"}
                  className="relative flex items-center justify-center"
                >
                  {/* Satellite 1 */}
                  <Liquid.Item
                    x={menuOpen ? -56 : 0}
                    y={menuOpen ? -36 : 0}
                    transition={{ duration: 400, ease: EASING_MAP.Bouncy }}
                    className="absolute"
                  >
                    <button
                      type="button"
                      aria-label="New Document"
                      tabIndex={menuOpen ? 0 : -1}
                      onClick={() => setMenuOpen(false)}
                      className={`w-10 h-10 rounded-full flex items-center justify-center transition-opacity ${
                        isDarkPage
                          ? "text-neutral-900 hover:bg-black/5"
                          : "text-white hover:bg-white/10"
                      }`}
                    >
                      <FileText size={16} className={`transition-opacity ${menuOpen ? "opacity-100" : "opacity-0"}`} />
                    </button>
                  </Liquid.Item>

                  {/* Satellite 2 */}
                  <Liquid.Item
                    x={0}
                    y={menuOpen ? -68 : 0}
                    transition={{ duration: 400, ease: EASING_MAP.Bouncy }}
                    delay={35}
                    className="absolute"
                  >
                    <button
                      type="button"
                      aria-label="Add Media"
                      tabIndex={menuOpen ? 0 : -1}
                      onClick={() => setMenuOpen(false)}
                      className={`w-10 h-10 rounded-full flex items-center justify-center transition-opacity ${
                        isDarkPage
                          ? "text-neutral-900 hover:bg-black/5"
                          : "text-white hover:bg-white/10"
                      }`}
                    >
                      <ImageIcon size={16} className={`transition-opacity ${menuOpen ? "opacity-100" : "opacity-0"}`} />
                    </button>
                  </Liquid.Item>

                  {/* Satellite 3 */}
                  <Liquid.Item
                    x={menuOpen ? 56 : 0}
                    y={menuOpen ? -36 : 0}
                    transition={{ duration: 400, ease: EASING_MAP.Bouncy }}
                    delay={70}
                    className="absolute"
                  >
                    <button
                      type="button"
                      aria-label="New Folder"
                      tabIndex={menuOpen ? 0 : -1}
                      onClick={() => setMenuOpen(false)}
                      className={`w-10 h-10 rounded-full flex items-center justify-center transition-opacity ${
                        isDarkPage
                          ? "text-neutral-900 hover:bg-black/5"
                          : "text-white hover:bg-white/10"
                      }`}
                    >
                      <FolderPlus size={16} className={`transition-opacity ${menuOpen ? "opacity-100" : "opacity-0"}`} />
                    </button>
                  </Liquid.Item>

                  {/* Central Toggle Button */}
                  <Liquid.Item className="relative z-10">
                    <button
                      type="button"
                      aria-label={menuOpen ? "Close menu" : "Open menu"}
                      onClick={() => setMenuOpen(!menuOpen)}
                      className={`w-11 h-11 rounded-full flex items-center justify-center bg-transparent border-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 ${
                        isDarkPage
                          ? "text-neutral-900 focus-visible:ring-black"
                          : "text-white focus-visible:ring-white"
                      }`}
                    >
                      <Plus
                        size={20}
                        className={`transition-transform duration-300 ${menuOpen ? "rotate-45" : "rotate-0"}`}
                      />
                    </button>
                  </Liquid.Item>
                </Liquid>
              </div>
              <p
                className={`text-[11px] text-center ${
                  isDarkPage ? "text-white/40" : "text-neutral-500"
                }`}
              >
                Click the + button — three satellite droplets bud out from the center with fluid surface tension.
              </p>
            </div>
          </div>
        </section>

        {/* Code Snippet Export */}
        <section
          className={`rounded-3xl border p-6 sm:p-8 space-y-4 transition-colors ${
            isDarkPage
              ? "bg-[#14151b] border-white/[0.08] shadow-xl"
              : "bg-white border-black/[0.07] shadow-sm"
          }`}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Code2
                size={16}
                className={isDarkPage ? "text-[#e6f5c0]" : "text-neutral-900"}
              />
              <h3
                className={`text-xs font-bold uppercase tracking-wider ${
                  isDarkPage ? "text-white" : "text-neutral-900"
                }`}
              >
                Export Component Code
              </h3>
            </div>
            <button
              type="button"
              onClick={handleCopyCode}
              className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-1.5 text-xs font-bold transition-all ${
                copiedCode
                  ? "bg-emerald-600 text-white"
                  : isDarkPage
                  ? "bg-white/10 text-white hover:bg-white/20"
                  : "bg-neutral-900 text-white hover:bg-neutral-800"
              }`}
            >
              {copiedCode ? <Check size={13} /> : <Copy size={13} />}
              {copiedCode ? "Copied to clipboard!" : "Copy React Code"}
            </button>
          </div>

          <div
            className={`relative rounded-2xl p-4 border overflow-x-auto ${
              isDarkPage
                ? "bg-[#090a0d] border-white/[0.06] text-white/80"
                : "bg-neutral-900 border-neutral-800 text-neutral-200"
            }`}
          >
            <pre className="text-xs font-mono leading-relaxed">
              <code>{generatedCode}</code>
            </pre>
          </div>
        </section>
      </div>
    </div>
  );
}
