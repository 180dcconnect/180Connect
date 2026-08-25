"use client";

import * as React from "react";
import Link from "next/link";
import { OriginButton } from "@/components/ui/origin-button";
import { Stage, Rise } from "@/components/dashboard-stage";
import { ArrowRight, Sparkles, Check, Download, Trash2, Settings, User } from "lucide-react";

export default function PreviewButtonsPage() {
  const [loading, setLoading] = React.useState(false);

  const simulateLoading = () => {
    setLoading(true);
    setTimeout(() => setLoading(false), 2000);
  };

  return (
    <div className="min-h-screen bg-[#f4f4ef] px-6 py-10 sm:px-10 sm:py-12">
      <Stage className="mx-auto w-full max-w-4xl space-y-10">
        <Rise className="flex flex-wrap items-center justify-between gap-4 border-b border-black/[0.08] pb-6">
          <div>
            <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-brand">
              Design System Preview
            </span>
            <h1 className="text-2xl font-black tracking-[-0.02em] text-foreground">
              OriginButton Motion & Color Palette
            </h1>
            <p className="mt-1 text-sm text-foreground/60">
              Interactive buttons with directional radial expansion hover fill animation.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/dashboard"
              className="rounded-full bg-black/5 px-4 py-2 text-xs font-bold text-foreground transition-colors hover:bg-black/10"
            >
              ← Back to Dashboard
            </Link>
          </div>
        </Rise>

        {/* Primary / Default Landing Glass Palette */}
        <Rise className="space-y-4 rounded-3xl border border-black/[0.06] bg-white p-6 shadow-sm">
          <div>
            <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-brand">
              Default Signature Variant
            </span>
            <h2 className="text-base font-bold text-foreground">
              Landing Page Glass Backdrop + Lime Green (#e6f5c0) Radial Hover Fill
            </h2>
            <p className="text-xs text-foreground/60">
              Frosted charcoal glass capsule with a lit top lip, expanding into the signature landing page lime green wash when hovered or tapped.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-4 pt-2">
            <OriginButton size="lg">
              Get Started <ArrowRight className="h-4 w-4" />
            </OriginButton>

            <OriginButton size="md">
              View Clients <ArrowRight className="h-4 w-4" />
            </OriginButton>

            <OriginButton size="sm">
              <Settings className="h-3.5 w-3.5" /> Preferences
            </OriginButton>

            <OriginButton size="xs">
              Quick Action
            </OriginButton>
          </div>
        </Rise>

        {/* Dark Ink Palette (Landing Page / Hero Accent) */}
        <Rise className="space-y-4 rounded-3xl bg-[#0c1014] p-6 shadow-xl text-white">
          <div>
            <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-white/40">
              Dark Ink Variant
            </span>
            <h2 className="text-base font-bold text-white">
              Dark Ink Surface (Landing & Sheet Tone)
            </h2>
            <p className="text-xs text-white/60">
              Sophisticated dark surface with subtle border and soft radial fill on hover.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-4 pt-2">
            <OriginButton variant="dark" size="lg">
              <Sparkles className="h-4 w-4" /> Premium Action
            </OriginButton>

            <OriginButton variant="dark" size="md">
              <User className="h-4 w-4" /> Account Settings
            </OriginButton>

            <OriginButton variant="dark" size="sm">
              <Download className="h-3.5 w-3.5" /> Export Data
            </OriginButton>
          </div>
        </Rise>

        {/* Outline & Ghost & Destructive Variants */}
        <Rise className="space-y-4 rounded-3xl border border-black/[0.06] bg-white p-6 shadow-sm">
          <div>
            <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/40">
              Secondary & Feedback Variants
            </span>
            <h2 className="text-base font-bold text-foreground">
              Outline, Ghost, Destructive & Loading States
            </h2>
          </div>

          <div className="flex flex-wrap items-center gap-4 pt-2">
            <OriginButton variant="outline" size="md">
              Outline Button
            </OriginButton>

            <OriginButton variant="ghost" size="md">
              Ghost Button
            </OriginButton>

            <OriginButton variant="destructive" size="md">
              <Trash2 className="h-4 w-4" /> Delete Record
            </OriginButton>

            <OriginButton
              variant="default"
              size="md"
              loading={loading}
              onClick={simulateLoading}
            >
              {loading ? "Saving changes…" : "Click to Test Loading"}
            </OriginButton>

            <OriginButton
              variant="default"
              size="md"
              href="/dashboard"
            >
              As Next.js Link →
            </OriginButton>
          </div>
        </Rise>

        {/* Comparison: In-Context in First-Run Guide Checklist */}
        <Rise className="space-y-4 rounded-3xl border border-brand/20 bg-brand/[0.04] p-6">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-brand">
                In-Context Preview
              </span>
              <h2 className="text-base font-bold text-foreground">
                First-Run Guide with OriginButton Style
              </h2>
            </div>
            <span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-foreground/70">
              2 of 2 complete
            </span>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl bg-white p-4">
            <div>
              <p className="font-bold text-foreground flex items-center gap-2">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-brand text-white text-xs">
                  ✓
                </span>
                <span>Set your outreach preferences</span>
              </p>
              <p className="text-xs text-foreground/60 mt-1">
                Tell us which locations and organisation sizes you want to focus on.
              </p>
            </div>
            <OriginButton variant="default" size="sm" href="/settings/outreach-preferences">
              Open preferences →
            </OriginButton>
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-2">
            <OriginButton variant="default" size="md">
              <Check className="h-4 w-4" /> Finish setup
            </OriginButton>

            <OriginButton variant="ghost" size="sm">
              Dismiss guide
            </OriginButton>
          </div>
        </Rise>
      </Stage>
    </div>
  );
}
