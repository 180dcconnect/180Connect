"use client";

import * as React from "react";
import { MorphingPopoverTextarea } from "@/components/ui/morphing-popover-textarea";
import { BackButton } from "@/components/ui/back-button";
import { Stage, Rise } from "@/components/dashboard-stage";
import { Sparkles, MessageSquarePlus, FileText, CheckCircle2 } from "lucide-react";

export default function PreviewMorphingPopoverPage() {
  const [submittedNotes, setSubmittedNotes] = React.useState<string[]>([
    "Initial discovery call completed with good engagement.",
    "Follow-up scheduled for next Tuesday regarding Q3 funding priorities.",
  ]);

  return (
    <div className="min-h-screen bg-[#f4f4ef] px-6 py-10 sm:px-10 sm:py-12">
      <Stage className="mx-auto w-full max-w-4xl space-y-10">
        {/* Header Bar */}
        <Rise className="flex flex-wrap items-center justify-between gap-4 border-b border-black/[0.08] pb-6 dark:border-white/[0.08]">
          <div>
            <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-brand">
              Component Preview
            </span>
            <h1 className="text-2xl font-black tracking-[-0.02em] text-foreground">
              Morphing Popover Textarea
            </h1>
            <p className="mt-1 text-sm text-foreground/60">
              Fluid shared-layout animation expanding from a compact action trigger into an interactive note composer.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <BackButton
              variant="sliding-door"
              size="sm"
              tone="bone"
              href="/dashboard"
            />
          </div>
        </Rise>

        {/* Live Interactive Showcase Card */}
        <Rise className="space-y-6 rounded-3xl border border-black/[0.06] bg-white p-8 shadow-sm dark:border-white/[0.08] dark:bg-card">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-brand/10 text-brand">
                <MessageSquarePlus size={18} strokeWidth={2.2} />
              </div>
              <div>
                <h2 className="text-base font-bold text-foreground">
                  Interactive Quick Note Composer
                </h2>
                <p className="text-xs text-foreground/60">
                  Click &ldquo;Add Note&rdquo; below to experience the morphing transition.
                </p>
              </div>
            </div>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400">
              <Sparkles size={13} />
              Framer Motion layoutId
            </span>
          </div>

          <div className="flex min-h-[260px] flex-col items-center justify-center rounded-2xl border border-dashed border-black/10 bg-[#fafaf7] p-10 dark:border-white/10 dark:bg-black/20">
            <div className="relative">
              <MorphingPopoverTextarea
                onSubmit={(newNote) => {
                  setSubmittedNotes((prev) => [newNote, ...prev]);
                }}
              />
            </div>
          </div>
        </Rise>

        {/* Simulated Client Notes Context */}
        <Rise className="space-y-4 rounded-3xl border border-black/[0.06] bg-white p-8 shadow-sm dark:border-white/[0.08] dark:bg-card">
          <div className="flex items-center justify-between border-b border-black/[0.06] pb-4 dark:border-white/[0.08]">
            <div className="flex items-center gap-2.5">
              <FileText size={18} className="text-muted-foreground" />
              <h3 className="text-sm font-bold text-foreground">Recent Client Activity Notes</h3>
            </div>
            <span className="text-[12px] text-muted-foreground">{submittedNotes.length} notes</span>
          </div>

          <div className="space-y-2.5">
            {submittedNotes.map((text, idx) => (
              <div
                key={idx}
                className="flex items-start gap-3 rounded-xl border border-black/[0.04] bg-[#fafaf7] p-3.5 text-sm dark:border-white/[0.04] dark:bg-black/10"
              >
                <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                <div className="flex-1">
                  <p className="text-foreground leading-relaxed">{text}</p>
                  <span className="mt-1 block text-[11px] text-muted-foreground">Just now · CAM Workspace</span>
                </div>
              </div>
            ))}
          </div>
        </Rise>
      </Stage>
    </div>
  );
}
