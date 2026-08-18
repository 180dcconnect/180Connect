"use client";

import { useState } from "react";
import Link from "next/link";
import { FirstRunGuide, type GuideStep } from "@/components/first-run-guide";
import { SidebarChecklist } from "@/components/sidebar-checklist";
import { PlayfulTodolist } from "@/components/animate-ui/components/community/playful-todolist";
import {
  ONBOARDING_STEPS,
  REVIEW_CLIENTS_EMPTY_STATE,
} from "@/lib/onboarding";
import { Stage, Rise } from "@/components/dashboard-stage";

/**
 * Interactive preview harness for F255 — New CAM First-Run Guide.
 * Matches preview-metric / preview-attention / preview-invite conventions.
 */
export default function PreviewGuidePage() {
  const [step1Done, setStep1Done] = useState(false);
  const [step2Done, setStep2Done] = useState(false);
  const [hasOwnedClients, setHasOwnedClients] = useState(false);

  const completedCount = (step1Done ? 1 : 0) + (step2Done ? 1 : 0);
  const allDone = step1Done && step2Done;

  const steps: GuideStep[] = [
    {
      key: "outreach_preferences",
      title: ONBOARDING_STEPS[0].title,
      description: ONBOARDING_STEPS[0].description,
      href: ONBOARDING_STEPS[0].href,
      cta: ONBOARDING_STEPS[0].cta,
      done: step1Done,
    },
    {
      key: "review_clients",
      title: ONBOARDING_STEPS[1].title,
      description: hasOwnedClients
        ? ONBOARDING_STEPS[1].description
        : REVIEW_CLIENTS_EMPTY_STATE.description,
      href: hasOwnedClients ? "/clients?owner=mock-cam-id" : "/clients",
      cta: hasOwnedClients
        ? ONBOARDING_STEPS[1].cta
        : REVIEW_CLIENTS_EMPTY_STATE.cta,
      done: step2Done,
    },
  ];

  return (
    <div className="min-h-screen bg-[#f4f4ef] px-6 py-10 sm:px-10 sm:py-12">
      <Stage className="mx-auto w-full max-w-4xl space-y-8">
        <Rise className="flex flex-wrap items-center justify-between gap-4 border-b border-black/[0.08] pb-6">
          <div>
            <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-brand">
              Preview Harness
            </span>
            <h1 className="text-2xl font-black tracking-[-0.02em] text-foreground">
              F255 New CAM First-Run Guide
            </h1>
            <p className="mt-1 text-sm text-foreground/60">
              Interactive playground to preview and edit checklist states and copy.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/preview-buttons"
              className="rounded-full bg-black/5 px-4 py-2 text-xs font-bold text-foreground transition-colors hover:bg-black/10"
            >
              OriginButton Showcase ✨
            </Link>
            <Link
              href="/dashboard?preview_guide=0"
              className="rounded-full bg-brand px-4 py-2 text-xs font-bold text-white shadow-xs transition-colors hover:bg-brand-hover"
            >
              View on live Dashboard →
            </Link>
          </div>
        </Rise>

        {/* State Controllers */}
        <Rise className="rounded-2xl border border-black/[0.06] bg-white p-6 shadow-sm">
          <h2 className="text-xs font-bold uppercase tracking-[0.12em] text-foreground/40">
            Interactive State Controls
          </h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-black/[0.06] p-3 transition-colors hover:bg-black/[0.02]">
              <input
                type="checkbox"
                checked={step1Done}
                onChange={(e) => setStep1Done(e.target.checked)}
                className="h-4 w-4 rounded accent-brand"
              />
              <div>
                <p className="text-sm font-bold">Step 1: Preferences</p>
                <p className="text-xs text-foreground/50">
                  {step1Done ? "Completed" : "Not started"}
                </p>
              </div>
            </label>

            <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-black/[0.06] p-3 transition-colors hover:bg-black/[0.02]">
              <input
                type="checkbox"
                checked={step2Done}
                onChange={(e) => setStep2Done(e.target.checked)}
                className="h-4 w-4 rounded accent-brand"
              />
              <div>
                <p className="text-sm font-bold">Step 2: Review clients</p>
                <p className="text-xs text-foreground/50">
                  {step2Done ? "Completed" : "Not started"}
                </p>
              </div>
            </label>

            <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-black/[0.06] p-3 transition-colors hover:bg-black/[0.02]">
              <input
                type="checkbox"
                checked={hasOwnedClients}
                onChange={(e) => setHasOwnedClients(e.target.checked)}
                className="h-4 w-4 rounded accent-brand"
              />
              <div>
                <p className="text-sm font-bold">Client ownership</p>
                <p className="text-xs text-foreground/50">
                  {hasOwnedClients ? "Owns assigned clients" : "Empty list variant"}
                </p>
              </div>
            </label>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2 pt-2 border-t border-black/[0.05]">
            <span className="text-xs text-foreground/50">Quick presets:</span>
            <button
              type="button"
              onClick={() => {
                setStep1Done(false);
                setStep2Done(false);
                setHasOwnedClients(false);
              }}
              className="rounded-lg bg-black/[0.04] px-2.5 py-1 text-xs font-semibold hover:bg-black/[0.08]"
            >
              0 / 2 (Brand New)
            </button>
            <button
              type="button"
              onClick={() => {
                setStep1Done(true);
                setStep2Done(false);
                setHasOwnedClients(false);
              }}
              className="rounded-lg bg-black/[0.04] px-2.5 py-1 text-xs font-semibold hover:bg-black/[0.08]"
            >
              1 / 2 (Preferences Done)
            </button>
            <button
              type="button"
              onClick={() => {
                setStep1Done(true);
                setStep2Done(true);
                setHasOwnedClients(true);
              }}
              className="rounded-lg bg-black/[0.04] px-2.5 py-1 text-xs font-semibold hover:bg-black/[0.08]"
            >
              2 / 2 (Ready to Finish)
            </button>
          </div>
        </Rise>

        {/* Live Guide Render */}
        <Rise className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-bold uppercase tracking-[0.12em] text-foreground/40">
              Live Component Preview
            </h2>
            <span className="text-xs font-bold text-brand">
              {completedCount} of {steps.length} complete {allDone ? "• All done" : ""}
            </span>
          </div>

          <FirstRunGuide
            steps={steps}
            completedCount={completedCount}
            allDone={allDone}
          />
        </Rise>

        {/* Sidebar Checklist Variants (Dark Mode vs Light Mode) */}
        <Rise className="space-y-4 pt-6 border-t border-black/[0.08]">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-brand">
                Sidebar Component
              </span>
              <h2 className="text-lg font-black tracking-tight text-foreground">
                Sidebar Checklist (Light vs Dark Mode)
              </h2>
              <p className="text-xs text-foreground/60">
                Compact widget positioned above the user profile in the sidebar.
              </p>
            </div>
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            {/* Dark Mode Card */}
            <div className="rounded-3xl bg-[#0c1014] p-6 shadow-xl">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-white/50">
                  Dark Mode (Landing & Sheet Style)
                </span>
                <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-bold text-white/80">
                  Dark Ink (#161b21)
                </span>
              </div>
              <div className="max-w-[240px]">
                <SidebarChecklist
                  steps={steps}
                  completedCount={completedCount}
                  totalCount={steps.length}
                  forceTheme="dark"
                />
              </div>
            </div>

            {/* Light Mode Card */}
            <div className="rounded-3xl bg-[#f4f4ef] border border-black/[0.08] p-6 shadow-sm">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-foreground/50">
                  Light Mode (Clean Dashboard Style)
                </span>
                <span className="rounded-full bg-black/5 px-2 py-0.5 text-[10px] font-bold text-foreground/70">
                  Light Bone / White
                </span>
              </div>
              <div className="max-w-[240px]">
                <SidebarChecklist
                  steps={steps}
                  completedCount={completedCount}
                  totalCount={steps.length}
                  forceTheme="light"
                />
              </div>
            </div>
          </div>
        </Rise>

        {/* Reference: @animate-ui/components-community-playful-todolist */}
        <Rise className="space-y-3 pt-6 border-t border-black/[0.08]">
          <div>
            <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-foreground/40">
              Installed Reference Component
            </span>
            <h2 className="text-sm font-bold text-foreground/75">
              @animate-ui/components-community-playful-todolist
            </h2>
          </div>
          <div className="max-w-md">
            <PlayfulTodolist />
          </div>
        </Rise>
      </Stage>
    </div>
  );
}
