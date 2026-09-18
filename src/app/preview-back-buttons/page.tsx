"use client";

import * as React from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "motion/react";
import {
  ArrowLeft,
  ChevronLeft,
  MoveLeft,
  Undo2,
  Copy,
  Check,
  Code2,
  Sliders,
  Sparkles,
} from "lucide-react";
import {
  BackButton,
  BackButtonVariant,
  BackButtonTone,
  BackButtonSize,
  BackButtonIcon,
} from "@/components/ui/back-button";
import { BackButtonDemo } from "@/components/ui/demo";
import { Rise } from "@/components/dashboard-stage";

interface StyleDefinition {
  id: BackButtonVariant;
  name: string;
  tagline: string;
  description: string;
  bestFor: string;
  inspiration: string;
  features: string[];
}

const STYLE_DEFINITIONS: StyleDefinition[] = [
  {
    id: "sliding-door",
    name: "Sliding-Door Expand Chamber",
    tagline: "1/4 Icon Chamber Expanding to 100% Surface on Hover",
    description:
      "A sleek modern button where the arrow glyph sits inside a dedicated 25% left chamber at rest. On hover, the text fades out while the icon chamber glides effortlessly to fill the entire 100% button width with high tactile feedback.",
    bestFor: "Action headers, Modal dismiss bars, Quick navigation pills",
    inspiration: "Modern shadcn Interactive Micro-interactions",
    features: [
      "25% resting left icon chamber",
      "Expands to 100% width on hover (duration-500)",
      "Label fades out gracefully (group-hover:opacity-0)",
      "Primary foreground 15% glass tint",
    ],
  },
  {
    id: "signature-dual",
    name: "Signature Dual-Capsule",
    tagline: "Brand Disc & Tangent Pill in Reverse Kinetics",
    description:
      "Mirrors the signature 180Connect landing CTA: a circular icon disc and text capsule meeting at a single tangent point. On hover, the arrow darts through horizontally while the pale lime (#e6f5c0) wash sweeps across the label.",
    bestFor: "Primary marketing transitions, Settings rail top header, Feature showcases",
    inspiration: "180Connect Brand CTA (src/components/brand/brand-cta.tsx)",
    features: [
      "Tangent disc + pill geometry",
      "Directional lime wash (#e6f5c0) sweep",
      "Continuous top lip specular highlight",
      "Spring lift recoil on hover",
    ],
  },
  {
    id: "glass-capsule",
    name: "Specular Floating Glass Capsule",
    tagline: "Translucent Frosted Pill with Top Lip Specular Highlight",
    description:
      "Polished iOS/macOS inspired glassmorphic pill with inset 1px specular lighting lip, 12px backdrop-blur, and an inner accent badge for the arrow glyph.",
    bestFor: "Dark hero banners, Client detail headers, Media overlays",
    inspiration: "Apple visionOS & macOS Glass Bars",
    features: [
      "Inset 1px specular white top lip",
      "Dynamic backdrop blur (12px)",
      "Inner glyph badge with micro-translation",
      "Subtle depth drop shadow on hover",
    ],
  },
  {
    id: "editorial-minimal",
    name: "Editorial Minimalist",
    tagline: "Typography-First with Animated Underline Wipe",
    description:
      "High-fashion editorial aesthetic featuring bold uppercase tracking, slender arrow glyph, and a directional underline expand/wipe effect matching the 180Connect Lato typography.",
    bestFor: "Clean content pages, Legal/policy pages, Minimalist admin subpages",
    inspiration: "Swiss Editorial Typography & Studio Portfolios",
    features: [
      "Zero-enclosure lightweight footprint",
      "Sliding underline sweep animation",
      "Wide uppercase kerning (tracking-wider)",
      "Stem arrow leftward lunge",
    ],
  },
  {
    id: "radial-wash",
    name: "Origin Radial-Wash",
    tagline: "Directional Ripple Fill from Icon Origin",
    description:
      "Leverages the OriginButton motion system: a lime or crisp ink wash radiates outward from the arrow icon across the capsule surface on hover with spring easing.",
    bestFor: "Interactive dashboards, Form workflow headers, Guided flows",
    inspiration: "OriginButton Motion System (src/components/ui/origin-button.tsx)",
    features: [
      "Center-origin radial wave expansion",
      "Smooth boundary clipping",
      "Instant visual engagement feedback",
      "Brand green accent highlight",
    ],
  },
  {
    id: "tactile-puck",
    name: "Tactile Squircle Puck & Label",
    tagline: "Dynamic Squircle Icon Badge with Fluid Title",
    description:
      "Separates the icon into a tactile squircle puck that shifts colors (bg-black/5 to brand green) on hover while the title shifts gracefully to the left.",
    bestFor: "Sidebar navigation, Account settings rails, Dense toolbars",
    inspiration: "Linear & Raycast Action Bars",
    features: [
      "Squircle icon badge with color flip",
      "Stacked label and destination subtitle",
      "Horizontal kinetic translation (-2px)",
      "Compact layout footprint",
    ],
  },
  {
    id: "breadcrumb-peek",
    name: "Segmented Context / Breadcrumb Peeker",
    tagline: "Dual-Segment Badge with Parent Context & Shortcut",
    description:
      "Combines an action pill with a destination preview segment and embedded keyboard shortcut badge (⌘[ or Esc), letting users know exactly where they are returning.",
    bestFor: "Deep nested pages, Client sub-tabs, Multi-step setup wizards",
    inspiration: "Notion & GitHub Breadcrumb Bars",
    features: [
      "Dual-pill segmented architecture",
      "Shows destination preview title",
      "Integrated keyboard shortcut badge",
      "Destination hover emphasis",
    ],
  },
  {
    id: "floating-disc",
    name: "Morphing Floating Action Disc",
    tagline: "Ultra-Compact 36px Disc Expanding into Full Label",
    description:
      "Starts as a clean circular disc taking minimal horizontal space, and smoothly expands into a full label capsule on hover or focus.",
    bestFor: "Mobile views, Fixed sticky floating headers, Tight table toolbars",
    inspiration: "Material 3 Floating Action Badges & Dynamic Island",
    features: [
      "Morphing width expansion on hover",
      "Minimalist icon-only resting footprint",
      "Smooth text reveal with opacity ramp",
      "Zero clutter for dense screen spaces",
    ],
  },
  {
    id: "neo-brutalist",
    name: "Neo-Brutalist Tactile Pill",
    tagline: "Crisp 2px Ink Border with Offset Drop Shadow",
    description:
      "Tactile physical button styling with a bold 2px ink border, offset hard shadow (3px 3px), and a satisfying physical press depression effect on click.",
    bestFor: "Fun internal tools, Community features, Bold marketing previews",
    inspiration: "Figma Neo-Brutalism & Modern Indie Web",
    features: [
      "2px solid ink outline",
      "Offset hard drop shadow (3px 3px)",
      "Physical tactile click depression",
      "Lime hover fill pop",
    ],
  },
];

export default function PreviewBackButtonsPage() {
  // Global Interactive Playground State
  const [selectedSize, setSelectedSize] = React.useState<BackButtonSize>("md");
  const [selectedTone, setSelectedTone] = React.useState<BackButtonTone>("bone");
  const [selectedIcon, setSelectedIcon] = React.useState<BackButtonIcon>("arrow");
  const [customLabel, setCustomLabel] = React.useState("Back");
  const [showShortcut, setShowShortcut] = React.useState(true);
  const [shortcutKey, setShortcutKey] = React.useState("⌘[");
  const [surfaceBg, setSurfaceBg] = React.useState<"bone" | "white" | "dark" | "gradient">("bone");

  // In-Context Mockup State
  const [sidebarVariant, setSidebarVariant] = React.useState<BackButtonVariant>("tactile-puck");
  const [heroVariant, setHeroVariant] = React.useState<BackButtonVariant>("glass-capsule");
  const [adminVariant, setAdminVariant] = React.useState<BackButtonVariant>("sliding-door");
  const [modalVariant, setModalVariant] = React.useState<BackButtonVariant>("breadcrumb-peek");

  // Interactive Click Feedback
  const [clickCount, setClickCount] = React.useState(0);
  const [lastClickedVariant, setLastClickedVariant] = React.useState<string | null>(null);
  const [copiedSnippet, setCopiedSnippet] = React.useState<string | null>(null);

  const handleClickFeedback = (variantName: string) => {
    setClickCount((c) => c + 1);
    setLastClickedVariant(variantName);
    setTimeout(() => setLastClickedVariant(null), 2500);
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedSnippet(id);
    setTimeout(() => setCopiedSnippet(null), 2000);
  };

  const surfaceBgClass = {
    bone: "bg-[#f4f4ef]",
    white: "bg-white",
    dark: "bg-[#0c1014] text-white",
    gradient: "bg-gradient-to-br from-[#1c1a18] via-[#0c1014] to-[#161b21] text-white",
  }[surfaceBg];

  return (
    <div className="min-h-screen bg-[#f4f4ef] text-foreground antialiased selection:bg-brand/20">
      {/* Toast Notification */}
      <AnimatePresence>
        {lastClickedVariant && (
          <motion.div
            initial={{ opacity: 0, y: -20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.95 }}
            className="fixed top-6 right-6 z-50 flex items-center gap-2.5 rounded-2xl border border-brand/30 bg-white/95 px-4 py-3 text-xs font-bold text-[#0c1014] shadow-xl backdrop-blur-xl"
          >
            <div className="flex size-5 items-center justify-center rounded-full bg-brand text-white">
              <Check className="size-3" strokeWidth={3} />
            </div>
            <span>
              Navigated back using <strong>{lastClickedVariant}</strong> (Click #{clickCount})
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-8 sm:py-14 space-y-16">
        {/* ─── Header & Metadata ─── */}
        <Rise className="space-y-4 border-b border-black/[0.08] pb-8">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-brand/15 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-brand">
                  Design System Showcase
                </span>
                <span className="rounded-full bg-black/5 px-2.5 py-0.5 text-[11px] font-medium text-foreground/60">
                  Interactive Exploration
                </span>
              </div>
              <h1 className="text-3xl sm:text-4xl font-black tracking-[-0.03em] text-foreground">
                Back Button Design Systems
              </h1>
              <p className="max-w-3xl text-sm sm:text-base leading-relaxed text-foreground/65">
                A comparative exploration of 180Connect’s <strong>4 current production back buttons</strong> alongside <strong>9 tailored new design styles</strong> (including the new Sliding-Door Chamber). Test live physics, tweak themes and sizes, and preview them inside real platform mockups.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Link
                href="/preview-buttons"
                className="rounded-full border border-black/10 bg-white px-4 py-2 text-xs font-bold text-foreground shadow-xs transition-colors hover:bg-black/5"
              >
                OriginButton Preview →
              </Link>
              <BackButton
                variant="sliding-door"
                size="sm"
                tone="bone"
                href="/dashboard"
              />
            </div>
          </div>
        </Rise>

        {/* ─── FEATURED SPOTLIGHT: Sliding Door Back Button (BackButtonDemo) ─── */}
        <Rise className="rounded-3xl border border-brand/30 bg-gradient-to-r from-brand/[0.08] via-brand/[0.03] to-white p-6 sm:p-8 shadow-sm space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="flex size-5 items-center justify-center rounded-full bg-brand text-white text-[11px] font-black">
                  <Sparkles className="size-3" />
                </span>
                <span className="text-xs font-bold uppercase tracking-wider text-brand">
                  New Component Spotlight
                </span>
              </div>
              <h2 className="text-xl font-bold tracking-tight text-foreground">
                Sliding-Door Expand Chamber Button (<code className="text-sm font-mono text-brand">BackButtonDemo</code>)
              </h2>
              <p className="text-xs text-foreground/65 max-w-2xl">
                Integrated directly into <code className="font-mono text-foreground">@/components/ui/back-button</code> and <code className="font-mono text-foreground">@/components/ui/demo</code> using shadcn <code className="font-mono text-foreground">Button</code> and Lucide icon chambers.
              </p>
            </div>

            <div className="flex items-center gap-4 bg-white rounded-2xl p-4 border border-black/[0.08] shadow-xs">
              <div className="text-xs font-bold text-foreground/70">Live Demo:</div>
              <BackButtonDemo />
            </div>
          </div>
        </Rise>

        {/* ─── SECTION 1: Current Back Buttons in Production ─── */}
        <Rise className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="flex size-6 items-center justify-center rounded-full bg-black/10 text-xs font-black">
                  1
                </span>
                <h2 className="text-xl font-bold tracking-tight text-foreground">
                  Current Back Buttons in Production
                </h2>
              </div>
              <p className="text-xs sm:text-sm text-foreground/60">
                Current status and active implementations of back navigation across 180Connect.
              </p>
            </div>
            <div className="flex items-center gap-2 text-xs font-bold text-brand">
              <span className="flex size-2 rounded-full bg-brand animate-pulse" />
              <span>Production Implementation Synced</span>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            {/* Location 1: Settings Sidebar Row */}
            <div className="flex flex-col justify-between rounded-3xl border border-black/[0.08] bg-white p-5 shadow-xs space-y-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-foreground/70">
                    1. Settings Rail Header
                  </span>
                  <span className="rounded-full bg-black/5 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-foreground/70">
                    Kept Original
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-foreground">
                    Text Link with Hover Background Pill
                  </h3>
                  <span className="text-[11px] font-mono text-foreground/40">
                    settings-sidebar.tsx
                  </span>
                </div>
                <p className="text-xs text-foreground/60 leading-relaxed">
                  Located at the top of the settings sidebar. Preserved in its original clean minimalist style per user preference.
                </p>
              </div>

              {/* Live Render */}
              <div className="rounded-2xl border border-black/5 bg-[#f4f4ef] p-4 flex items-center justify-center min-h-[72px]">
                <Link
                  href="#current-demo"
                  onClick={(e) => {
                    e.preventDefault();
                    handleClickFeedback("Settings Sidebar Back Row");
                  }}
                  className="group flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-bold text-black/85 transition-all hover:bg-black/10 hover:text-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
                >
                  <ArrowLeft
                    className="h-4 w-4 shrink-0 transition-transform duration-200 group-hover:-translate-x-0.5"
                    strokeWidth={2}
                    aria-hidden="true"
                  />
                  Back to app
                </Link>
              </div>

              <div className="rounded-xl bg-black/[0.03] p-3 text-[11px] text-foreground/70 space-y-1">
                <div className="font-semibold text-foreground/90">Production Status:</div>
                <div className="text-brand font-medium">✓ Preserved as original text row in settings sidebar.</div>
              </div>
            </div>

            {/* Location 2: Client Detail Hero */}
            <div className="flex flex-col justify-between rounded-3xl border border-black/[0.08] bg-[#1c1a18] p-5 text-white shadow-md space-y-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-[#e6f5c0]">
                    2. Client Record Hero
                  </span>
                  <span className="rounded-full bg-[#e6f5c0]/20 text-[#e6f5c0] border border-[#e6f5c0]/30 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider">
                    Updated: Sliding Door
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-white">
                    Sliding-Door Chamber (Dark Glass)
                  </h3>
                  <span className="text-[11px] font-mono text-white/40">
                    clients/[id]/page.tsx
                  </span>
                </div>
                <p className="text-xs text-white/65 leading-relaxed">
                  Active in the client record hero banner. Translucent frosted glass with expanding Pale Lime chamber and rounded-md radius.
                </p>
              </div>

              {/* Live Render */}
              <div className="rounded-2xl border border-white/10 bg-black/40 p-4 flex items-center justify-center min-h-[72px]">
                <BackButton
                  variant="sliding-door"
                  tone="dark"
                  size="sm"
                  onClick={() => handleClickFeedback("Client Record Hero Button")}
                />
              </div>

              <div className="rounded-xl bg-white/[0.06] p-3 text-[11px] text-white/70 space-y-1">
                <div className="font-semibold text-white/90">Production Status:</div>
                <div className="text-[#e6f5c0] font-medium">✓ Implemented with refined dark tone & original border radius.</div>
              </div>
            </div>

            {/* Location 3: Admin & Subpages */}
            <div className="flex flex-col justify-between rounded-3xl border border-black/[0.08] bg-white p-5 shadow-xs space-y-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-brand">
                    3. Admin Subpage Links
                  </span>
                  <span className="rounded-full bg-brand/10 text-brand border border-brand/20 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider">
                    Updated: Editorial Minimal
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-foreground">
                    Editorial Minimalist (Stem Arrow + Wipe)
                  </h3>
                  <span className="text-[11px] font-mono text-foreground/40">
                    admin/*, accessibility, new
                  </span>
                </div>
                <p className="text-xs text-foreground/60 leading-relaxed">
                  Active across admin sub-settings, accessibility, and client creation with animated underline wipe and darting arrow.
                </p>
              </div>

              {/* Live Render */}
              <div className="rounded-2xl border border-black/5 bg-[#f4f4ef] p-4 flex items-center justify-center min-h-[72px]">
                <BackButton
                  variant="editorial-minimal"
                  onClick={() => handleClickFeedback("Admin Editorial Minimal Link")}
                />
              </div>

              <div className="rounded-xl bg-black/[0.03] p-3 text-[11px] text-foreground/70 space-y-1">
                <div className="font-semibold text-foreground/90">Production Status:</div>
                <div className="text-brand font-medium">✓ Implemented across 6 admin and sub-setting pages.</div>
              </div>
            </div>

            {/* Location 4: Preview Top Bar Capsule */}
            <div className="flex flex-col justify-between rounded-3xl border border-black/[0.08] bg-white p-5 shadow-xs space-y-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-brand">
                    4. Preview Top Bar Capsule
                  </span>
                  <span className="rounded-full bg-brand/10 text-brand border border-brand/20 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider">
                    Updated: Sliding Door
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-foreground">
                    Sliding-Door Chamber (Bone/Porcelain)
                  </h3>
                  <span className="text-[11px] font-mono text-foreground/40">
                    preview-buttons, qr, etc.
                  </span>
                </div>
                <p className="text-xs text-foreground/60 leading-relaxed">
                  Active across development preview pages. Crisp porcelain button with Dark Ink expanding chamber on hover.
                </p>
              </div>

              {/* Live Render */}
              <div className="rounded-2xl border border-black/5 bg-[#f4f4ef] p-4 flex items-center justify-center min-h-[72px]">
                <BackButton
                  variant="sliding-door"
                  size="sm"
                  tone="bone"
                  onClick={() => handleClickFeedback("Preview Top Bar Button")}
                />
              </div>

              <div className="rounded-xl bg-black/[0.03] p-3 text-[11px] text-foreground/70 space-y-1">
                <div className="font-semibold text-foreground/90">Production Status:</div>
                <div className="text-brand font-medium">✓ Implemented across preview toolbars.</div>
              </div>
            </div>
          </div>
        </Rise>

        {/* ─── SECTION 2: Interactive Playground & 9 New Styles ─── */}
        <Rise className="space-y-8">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="flex size-6 items-center justify-center rounded-full bg-brand text-white text-xs font-black">
                  2
                </span>
                <h2 className="text-xl font-bold tracking-tight text-foreground">
                  9 Tailored Back Button Styles
                </h2>
              </div>
              <p className="text-xs sm:text-sm text-foreground/60">
                Explore each design style with live hover animations, custom props, and surface background switchers.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-foreground/60">Preview Surface:</span>
              <div className="flex items-center rounded-xl bg-white p-1 border border-black/[0.08] shadow-xs">
                {(["bone", "white", "dark", "gradient"] as const).map((bg) => (
                  <button
                    key={bg}
                    onClick={() => {
                      setSurfaceBg(bg);
                      setSelectedTone(bg === "dark" || bg === "gradient" ? "dark" : bg === "white" ? "light" : "bone");
                    }}
                    className={`rounded-lg px-2.5 py-1 text-xs font-bold transition-all capitalize ${
                      surfaceBg === bg
                        ? "bg-[#0c1014] text-white shadow-xs"
                        : "text-foreground/70 hover:text-foreground hover:bg-black/5"
                    }`}
                  >
                    {bg}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Interactive Controls Bar */}
          <div className="rounded-3xl border border-black/[0.08] bg-white p-5 shadow-xs space-y-5">
            <div className="flex items-center justify-between border-b border-black/[0.06] pb-3">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-brand">
                <Sliders className="size-3.5" />
                <span>Playground Customizer & Global Controls</span>
              </div>
              <span className="text-xs text-foreground/50">Changes apply to all styles below</span>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {/* Size Switcher */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-foreground/70">Scale / Size</label>
                <div className="flex rounded-xl bg-[#f4f4ef] p-1 border border-black/[0.06]">
                  {(["sm", "md", "lg"] as const).map((sz) => (
                    <button
                      key={sz}
                      onClick={() => setSelectedSize(sz)}
                      className={`flex-1 rounded-lg py-1 text-xs font-bold uppercase transition-all ${
                        selectedSize === sz
                          ? "bg-white text-foreground shadow-xs font-black"
                          : "text-foreground/60 hover:text-foreground"
                      }`}
                    >
                      {sz}
                    </button>
                  ))}
                </div>
              </div>

              {/* Icon Glyphs */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-foreground/70">Arrow Glyph</label>
                <div className="flex rounded-xl bg-[#f4f4ef] p-1 border border-black/[0.06]">
                  {(
                    [
                      { id: "arrow", icon: ArrowLeft, label: "Arrow" },
                      { id: "chevron", icon: ChevronLeft, label: "Chevron" },
                      { id: "long-arrow", icon: MoveLeft, label: "Long" },
                      { id: "undo", icon: Undo2, label: "Undo" },
                    ] as const
                  ).map((item) => (
                    <button
                      key={item.id}
                      onClick={() => setSelectedIcon(item.id)}
                      className={`flex-1 flex items-center justify-center rounded-lg py-1 text-xs font-bold transition-all ${
                        selectedIcon === item.id
                          ? "bg-white text-foreground shadow-xs"
                          : "text-foreground/60 hover:text-foreground"
                      }`}
                      title={item.label}
                    >
                      <item.icon className="size-3.5" strokeWidth={2.2} />
                    </button>
                  ))}
                </div>
              </div>

              {/* Custom Label Input */}
              <div className="space-y-1.5 sm:col-span-2">
                <label className="text-xs font-bold text-foreground/70">Button Label</label>
                <input
                  type="text"
                  value={customLabel}
                  onChange={(e) => setCustomLabel(e.target.value)}
                  placeholder="Label..."
                  className="w-full rounded-xl border border-black/[0.08] bg-[#f4f4ef] px-3 py-1.5 text-xs font-bold text-foreground outline-none focus:border-brand focus:bg-white"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-2 text-xs border-t border-black/[0.05]">
              <label className="flex items-center gap-2 cursor-pointer font-bold text-foreground/70">
                <input
                  type="checkbox"
                  checked={showShortcut}
                  onChange={(e) => setShowShortcut(e.target.checked)}
                  className="rounded border-black/20 text-brand focus:ring-brand"
                />
                <span>Include Keyboard Shortcut Indicator</span>
              </label>

              {showShortcut && (
                <div className="flex items-center gap-2">
                  <span className="text-foreground/50">Shortcut tag:</span>
                  <div className="flex gap-1">
                    {["⌘[", "Esc", "Alt+←"].map((key) => (
                      <button
                        key={key}
                        onClick={() => setShortcutKey(key)}
                        className={`rounded-md px-2 py-0.5 text-[11px] font-mono font-bold transition-colors ${
                          shortcutKey === key
                            ? "bg-[#0c1014] text-white"
                            : "bg-[#f4f4ef] text-foreground/70 hover:bg-black/10"
                        }`}
                      >
                        {key}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* 9 Style Cards Grid */}
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            {STYLE_DEFINITIONS.map((def, idx) => {
              const snippetCode = `<BackButton\n  variant="${def.id}"\n  size="${selectedSize}"\n  tone="${selectedTone}"\n  label="${customLabel}"\n  href="/previous-page"\n/>`;

              return (
                <div
                  key={def.id}
                  className="flex flex-col justify-between rounded-3xl border border-black/[0.08] bg-white p-6 shadow-sm hover:shadow-md transition-all space-y-6"
                >
                  <div className="space-y-3">
                    {/* Header */}
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="flex size-5 items-center justify-center rounded-full bg-brand/15 text-[11px] font-black text-brand">
                            {idx + 1}
                          </span>
                          <h3 className="text-base font-black tracking-tight text-foreground">
                            {def.name}
                          </h3>
                        </div>
                        <p className="text-xs font-bold text-brand mt-0.5">
                          {def.tagline}
                        </p>
                      </div>

                      <button
                        onClick={() => copyToClipboard(snippetCode, def.id)}
                        className="flex items-center gap-1.5 rounded-full bg-black/5 px-3 py-1 text-[11px] font-bold text-foreground/70 hover:bg-black/10 hover:text-foreground transition-colors"
                        title="Copy JSX Code"
                      >
                        {copiedSnippet === def.id ? (
                          <>
                            <Check className="size-3 text-brand" />
                            <span className="text-brand">Copied</span>
                          </>
                        ) : (
                          <>
                            <Copy className="size-3" />
                            <span>JSX</span>
                          </>
                        )}
                      </button>
                    </div>

                    <p className="text-xs text-foreground/65 leading-relaxed">
                      {def.description}
                    </p>

                    {/* Feature tags */}
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {def.features.map((feat) => (
                        <span
                          key={feat}
                          className="rounded-md bg-[#f4f4ef] px-2 py-0.5 text-[10px] font-medium text-foreground/70"
                        >
                          • {feat}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Interactive Live Canvas */}
                  <div className="space-y-2">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-foreground/40">
                      Live Interactive Sandbox (Hover & Click Me)
                    </div>
                    <div
                      className={`relative flex min-h-[96px] items-center justify-center rounded-2xl p-6 transition-all duration-300 border border-black/5 ${surfaceBgClass}`}
                    >
                      <BackButton
                        variant={def.id}
                        size={selectedSize}
                        tone={selectedTone}
                        icon={selectedIcon}
                        label={customLabel}
                        shortcut={showShortcut ? shortcutKey : undefined}
                        onClick={() => handleClickFeedback(def.name)}
                      />
                    </div>
                  </div>

                  {/* Best For Footer */}
                  <div className="rounded-xl bg-black/[0.02] p-3 text-[11px] space-y-1 border border-black/[0.04]">
                    <div className="text-foreground/50">
                      <strong>Best suited for:</strong> {def.bestFor}
                    </div>
                    <div className="text-foreground/40 text-[10px]">
                      <strong>Inspiration:</strong> {def.inspiration}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </Rise>

        {/* ─── SECTION 3: Real-World In-Context Mockups ─── */}
        <Rise className="space-y-8">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="flex size-6 items-center justify-center rounded-full bg-brand text-white text-xs font-black">
                3
              </span>
              <h2 className="text-xl font-bold tracking-tight text-foreground">
                Real-World In-Context Previews
              </h2>
            </div>
            <p className="text-xs sm:text-sm text-foreground/60">
              See how the proposed back buttons look inside real 180Connect interfaces and workflows.
            </p>
          </div>

          <div className="space-y-8">
            {/* CONTEXT 1: Settings Sidebar Rail */}
            <div className="overflow-hidden rounded-3xl border border-black/[0.08] bg-white shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-black/[0.08] bg-[#f4f4ef] px-6 py-4">
                <div>
                  <span className="text-[11px] font-bold uppercase tracking-wider text-brand">
                    Context Mockup A
                  </span>
                  <h3 className="text-base font-bold text-foreground">
                    Settings Sidebar Rail Header
                  </h3>
                  <p className="text-xs text-foreground/60">
                    Replacing the plain row at the top of the settings sidebar (src/components/settings-sidebar.tsx).
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-foreground/60">Change Style:</span>
                  <select
                    value={sidebarVariant}
                    onChange={(e) => setSidebarVariant(e.target.value as BackButtonVariant)}
                    className="rounded-xl border border-black/10 bg-white px-3 py-1.5 text-xs font-bold text-foreground shadow-xs outline-none focus:border-brand"
                  >
                    {STYLE_DEFINITIONS.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex flex-col md:flex-row bg-[#e8e8e2] p-4 sm:p-8 gap-6">
                {/* Fake Sidebar Mock */}
                <div className="w-full md:w-64 shrink-0 rounded-2xl bg-white/80 p-4 shadow-sm backdrop-blur-md border border-white/60 space-y-6">
                  {/* Top Back Row */}
                  <div className="border-b border-black/[0.06] pb-4">
                    <BackButton
                      variant={sidebarVariant}
                      size="sm"
                      tone="bone"
                      label="Back to app"
                      onClick={() => handleClickFeedback("Sidebar Rail Header")}
                    />
                  </div>

                  {/* Nav Links */}
                  <div className="space-y-4">
                    <div>
                      <p className="px-3 pb-1 text-[10px] font-bold uppercase tracking-wider text-black/40">
                        Preferences
                      </p>
                      <div className="space-y-1">
                        <div className="rounded-xl bg-black/10 px-3 py-2 text-xs font-bold text-black">
                          Outreach preferences
                        </div>
                        <div className="rounded-xl px-3 py-2 text-xs font-semibold text-black/70 hover:bg-black/5">
                          Account details
                        </div>
                        <div className="rounded-xl px-3 py-2 text-xs font-semibold text-black/70 hover:bg-black/5">
                          Accessibility
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Main Content Mock */}
                <div className="flex-1 rounded-2xl bg-white p-6 shadow-sm border border-black/[0.06] space-y-4">
                  <div className="space-y-1">
                    <h4 className="text-xl font-bold tracking-tight text-foreground">
                      Outreach Preferences
                    </h4>
                    <p className="text-xs text-foreground/60">
                      Configure which charities and sectors are automatically assigned to your outreach queue.
                    </p>
                  </div>
                  <div className="h-32 rounded-xl bg-[#f4f4ef] border border-black/[0.04] p-4 flex items-center justify-center text-xs font-medium text-foreground/40">
                    [ Preferences Form Fields Canvas ]
                  </div>
                </div>
              </div>
            </div>

            {/* CONTEXT 2: Dark Hero Banner (Client Detail Record) */}
            <div className="overflow-hidden rounded-3xl border border-black/[0.08] bg-[#0c1014] text-white shadow-xl">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 bg-[#161b21] px-6 py-4">
                <div>
                  <span className="text-[11px] font-bold uppercase tracking-wider text-[#e6f5c0]">
                    Context Mockup B
                  </span>
                  <h3 className="text-base font-bold text-white">
                    Client Record Dark Charcoal Hero
                  </h3>
                  <p className="text-xs text-white/60">
                    Navigating back from /clients/[id] to the working client pipeline.
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-white/60">Change Style:</span>
                  <select
                    value={heroVariant}
                    onChange={(e) => setHeroVariant(e.target.value as BackButtonVariant)}
                    className="rounded-xl border border-white/15 bg-black/60 px-3 py-1.5 text-xs font-bold text-white shadow-xs outline-none focus:border-[#e6f5c0]"
                  >
                    {STYLE_DEFINITIONS.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Hero Banner Canvas */}
              <div className="relative overflow-hidden bg-[#1c1a18] p-6 sm:p-10 space-y-6">
                {/* Background glow and watermark */}
                <div className="absolute -bottom-24 -left-16 size-72 rounded-full bg-brand/20 blur-3xl pointer-events-none" />
                <span className="absolute -bottom-10 right-4 select-none text-[8rem] font-black leading-none text-[#e6f5c0]/[0.04] pointer-events-none">
                  OX
                </span>

                {/* Back Button Position */}
                <div className="relative z-10">
                  <BackButton
                    variant={heroVariant}
                    size="sm"
                    tone="dark"
                    onClick={() => handleClickFeedback("Client Dark Hero Back Button")}
                  />
                </div>

                {/* Client Info Mock */}
                <div className="relative z-10 flex flex-wrap items-start justify-between gap-6 pt-2">
                  <div className="flex items-center gap-4">
                    <span className="flex size-14 items-center justify-center rounded-2xl bg-[#e6f5c0] text-xl font-black text-[#10130c] shadow-lg">
                      OX
                    </span>
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/40">
                        Client Record · 180DC London
                      </p>
                      <h3 className="text-2xl font-black tracking-tight text-white">
                        Oxfam GB International
                      </h3>
                      <p className="text-xs text-white/60 mt-0.5">
                        Registered Charity #202918 · International Development
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <span className="rounded-full bg-brand/20 border border-brand/30 px-3 py-1 text-xs font-bold text-brand">
                      High Priority (88.4)
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* CONTEXT 3: Admin Management Header */}
            <div className="overflow-hidden rounded-3xl border border-black/[0.08] bg-white shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-black/[0.08] bg-[#f4f4ef] px-6 py-4">
                <div>
                  <span className="text-[11px] font-bold uppercase tracking-wider text-brand">
                    Context Mockup C
                  </span>
                  <h3 className="text-base font-bold text-foreground">
                    Admin Page Header (CAM Queue Settings)
                  </h3>
                  <p className="text-xs text-foreground/60">
                    Replacing text-brand links in /admin/cam-settings, /admin/score-settings, /admin/ml-readiness.
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-foreground/60">Change Style:</span>
                  <select
                    value={adminVariant}
                    onChange={(e) => setAdminVariant(e.target.value as BackButtonVariant)}
                    className="rounded-xl border border-black/10 bg-white px-3 py-1.5 text-xs font-bold text-foreground shadow-xs outline-none focus:border-brand"
                  >
                    {STYLE_DEFINITIONS.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Admin Header Canvas */}
              <div className="bg-[#f4f4ef] p-6 sm:p-10 space-y-6">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="space-y-1">
                    <BackButton
                      variant={adminVariant}
                      size="sm"
                      tone="bone"
                      onClick={() => handleClickFeedback("Admin Header Back Link")}
                    />
                    <h3 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground pt-2">
                      CAM Queue Settings
                    </h3>
                    <p className="text-xs text-foreground/60 max-w-xl">
                      Inspect how team members have configured their outreach queues (F187). Preferences filter prospects by geography and charity sector.
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="rounded-xl bg-white border border-black/[0.08] px-3 py-1.5 text-xs font-bold text-foreground shadow-xs">
                      12 Active CAMs
                    </span>
                  </div>
                </div>

                <div className="rounded-2xl border border-black/[0.06] bg-white p-5 shadow-xs flex items-center justify-between text-xs text-foreground/60">
                  <span>Showing 12 queue weighting configurations</span>
                  <span className="font-bold text-brand">All queues operational</span>
                </div>
              </div>
            </div>

            {/* CONTEXT 4: Slide-Over Sheet / Drawer Header */}
            <div className="overflow-hidden rounded-3xl border border-black/[0.08] bg-white shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-black/[0.08] bg-[#f4f4ef] px-6 py-4">
                <div>
                  <span className="text-[11px] font-bold uppercase tracking-wider text-brand">
                    Context Mockup D
                  </span>
                  <h3 className="text-base font-bold text-foreground">
                    Slide-Over Sheet & Modal Header
                  </h3>
                  <p className="text-xs text-foreground/60">
                    Header bar inside client details drawers, quick edit panels, and preview sheets.
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-foreground/60">Change Style:</span>
                  <select
                    value={modalVariant}
                    onChange={(e) => setModalVariant(e.target.value as BackButtonVariant)}
                    className="rounded-xl border border-black/10 bg-white px-3 py-1.5 text-xs font-bold text-foreground shadow-xs outline-none focus:border-brand"
                  >
                    {STYLE_DEFINITIONS.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Drawer Sheet Canvas */}
              <div className="bg-[#e2e2dc] p-6 sm:p-10 flex justify-end">
                <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl border border-black/[0.08] space-y-6">
                  <div className="flex items-center justify-between border-b border-black/[0.06] pb-4">
                    <BackButton
                      variant={modalVariant}
                      size="sm"
                      tone="bone"
                      label="Close"
                      shortcut="Esc"
                      onClick={() => handleClickFeedback("Drawer Sheet Back/Close")}
                    />
                    <span className="rounded-full bg-brand/10 px-2.5 py-1 text-[10px] font-bold text-brand uppercase tracking-wider">
                      Draft Saved
                    </span>
                  </div>

                  <div className="space-y-3">
                    <h4 className="text-base font-bold text-foreground">
                      Compose Outreach Follow-up
                    </h4>
                    <p className="text-xs text-foreground/60">
                      Sending from Ben (CAM) · ben.curran@180dc.org
                    </p>
                    <div className="h-24 rounded-2xl bg-[#f4f4ef] border border-black/[0.06] p-3 text-xs text-foreground/40">
                      Dear Director of Partnerships, following up on our introductory note...
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </Rise>

        {/* ─── SECTION 4: Code Generation & Usage Snippet ─── */}
        <Rise className="rounded-3xl border border-black/[0.08] bg-[#0c1014] p-6 sm:p-8 text-white shadow-xl space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[#e6f5c0]">
                <Code2 className="size-4" />
                <span>Ready-To-Use Code Generator</span>
              </div>
              <h3 className="text-lg font-bold text-white">
                Drop-in Implementation for Any Page
              </h3>
            </div>

            <button
              onClick={() => {
                const code = `import { BackButton } from "@/components/ui/back-button";\n\n// Inside your page or header component:\n<BackButton\n  variant="${sidebarVariant}"\n  size="${selectedSize}"\n  tone="${selectedTone}"\n  label="${customLabel}"\n  href="/dashboard"\n/>`;
                copyToClipboard(code, "full-snippet");
              }}
              className="flex items-center gap-2 rounded-full bg-[#e6f5c0] px-4 py-2 text-xs font-bold text-[#0c1014] shadow-md transition-all hover:bg-white"
            >
              {copiedSnippet === "full-snippet" ? (
                <>
                  <Check className="size-3.5 text-[#0c1014]" />
                  <span>Copied to Clipboard!</span>
                </>
              ) : (
                <>
                  <Copy className="size-3.5" />
                  <span>Copy Complete Snippet</span>
                </>
              )}
            </button>
          </div>

          <div className="space-y-3">
            <p className="text-xs text-white/65">
              The BackButton component automatically detects whether <code className="text-[#e6f5c0]">href</code> is passed (rendering a Next.js Link) or falls back to <code className="text-[#e6f5c0]">router.back()</code> if no URL is specified.
            </p>

            <pre className="overflow-x-auto rounded-2xl bg-black/70 p-5 font-mono text-xs text-emerald-400 border border-white/10 leading-relaxed">
{`import { BackButton } from "@/components/ui/back-button";

export function PageHeader() {
  return (
    <header className="flex items-center justify-between">
      <BackButton
        variant="sliding-door"
        size="md"
        tone="bone"
        label="Back"
        destination="Clients"
        shortcut="⌘["
        href="/clients"
      />
    </header>
  );
}`}
            </pre>
          </div>
        </Rise>
      </div>
    </div>
  );
}
