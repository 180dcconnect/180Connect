"use client";

import { useState } from "react";
import Link from "next/link";
import { FaceRating } from "@/components/spectrumui/face-rating";
import { RATING_LABELS, averageRating } from "@/lib/feedback";
import { Stage, Rise, Group } from "@/components/dashboard-stage";
import { OriginButton } from "@/components/ui/origin-button";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { X } from "lucide-react";

const RATING_EMOJI = ["😡", "😕", "😐", "🙂", "😄"];

const MOCK_SUBMISSIONS = [
  {
    id: "1",
    author: "Mohammed (Admin)",
    rating: 5,
    comment: "The client search and filter performance is noticeably faster. Great work!",
    time: "10m ago",
    context: "/dashboard",
  },
  {
    id: "2",
    author: "Ben (CAM)",
    rating: 4,
    comment: "Smooth onboarding flow. Would be great if we could pin priority charities.",
    time: "2h ago",
    context: "/clients",
  },
  {
    id: "3",
    author: "Elena (Viewer)",
    rating: 5,
    comment: null,
    time: "1d ago",
    context: "/dashboard",
  },
  {
    id: "4",
    author: "Alex (CAM)",
    rating: 3,
    comment: "Takes a couple seconds to reassign accounts during peak hours.",
    time: "3d ago",
    context: "/admin/users",
  },
];

/**
 * Interactive preview harness for the In-App Feedback feature.
 * Matches preview-guide / preview-metric / preview-buttons conventions.
 */
export default function PreviewFeedbackPage() {
  const [standaloneRating, setStandaloneRating] = useState(4);
  const [size, setSize] = useState<"sm" | "md" | "lg">("md");
  
  // Floating prompt preview state
  const [promptOpen, setPromptOpen] = useState(true);
  const [promptRating, setPromptRating] = useState(0);
  const [promptComment, setPromptComment] = useState("");
  const [promptSubmitted, setPromptSubmitted] = useState(false);
  const reduceMotion = useReducedMotion();

  const handlePromptSubmit = () => {
    if (promptRating === 0) return;
    setPromptSubmitted(true);
    setTimeout(() => {
      setPromptOpen(false);
    }, 5000);
  };

  const handleResetPrompt = () => {
    setPromptRating(0);
    setPromptComment("");
    setPromptSubmitted(false);
    setPromptOpen(true);
  };

  const ratings = MOCK_SUBMISSIONS.map((s) => s.rating);
  const avg = averageRating(ratings);
  const distribution = [0, 0, 0, 0, 0];
  for (const r of ratings) distribution[r - 1]++;
  const maxCount = Math.max(...distribution, 1);

  return (
    <div className="min-h-screen bg-[#f4f4ef] px-6 py-10 sm:px-10 sm:py-12">
      <Stage className="mx-auto w-full max-w-4xl space-y-10">
        <Rise className="flex flex-wrap items-center justify-between gap-4 border-b border-black/[0.08] pb-6">
          <div>
            <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-brand">
              Preview Harness
            </span>
            <h1 className="text-2xl font-black tracking-[-0.02em] text-foreground">
              In-App Feedback Component Preview
            </h1>
            <p className="mt-1 text-sm text-foreground/60">
              Interactive playground to inspect the Spectrum UI face rating, prompt widget, and admin feed.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/admin/feedback"
              className="rounded-full bg-black/5 px-4 py-2 text-xs font-bold text-foreground transition-colors hover:bg-black/10"
            >
              Admin Feedback Page →
            </Link>
            <OriginButton href="/dashboard?preview_feedback=true" size="sm">
              Live on Dashboard →
            </OriginButton>
          </div>
        </Rise>

        {/* Section 1: Face Rating Component Sandbox */}
        <Group className="space-y-4">
          <Rise className="flex items-baseline justify-between">
            <div>
              <h2 className="text-lg font-bold tracking-tight text-foreground">
                1. Spectrum UI Face Rating Component
              </h2>
              <p className="text-xs text-foreground/50">
                Smooth SVG morphing face with spring physics and accessible radio group.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-foreground/50">Size:</span>
              {(["sm", "md", "lg"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setSize(s)}
                  className={`rounded-lg px-2.5 py-1 text-xs font-bold transition-all ${
                    size === s ? "bg-black text-white" : "bg-black/5 text-foreground hover:bg-black/10"
                  }`}
                >
                  {s.toUpperCase()}
                </button>
              ))}
            </div>
          </Rise>

          <Rise>
            <div className="flex flex-col items-center justify-center rounded-2xl border border-black/[0.06] bg-white p-8 shadow-sm">
              <FaceRating
                value={standaloneRating}
                onValueChange={setStandaloneRating}
                labels={RATING_LABELS as unknown as [string, string, string, string, string]}
                size={size}
              />
              <div className="mt-6 flex items-center gap-3 rounded-full bg-[#f4f4ef] px-4 py-1.5 text-xs">
                <span className="font-semibold text-foreground/60">Selected rating:</span>
                <span className="font-bold text-foreground">
                  {standaloneRating}/5 ({RATING_LABELS[standaloneRating - 1]})
                </span>
              </div>
            </div>
          </Rise>
        </Group>

        {/* Section 2: Floating Prompt Interactive Mock */}
        <Group className="space-y-4">
          <Rise className="flex items-baseline justify-between">
            <div>
              <h2 className="text-lg font-bold tracking-tight text-foreground">
                2. Floating Dashboard Prompt Widget
              </h2>
              <p className="text-xs text-foreground/50">
                Non-blocking floating card with blur-up animation and auto-snooze on submit/dismiss.
              </p>
            </div>
            <button
              onClick={handleResetPrompt}
              className="rounded-full bg-brand/10 px-3.5 py-1.5 text-xs font-bold text-brand hover:bg-brand/20 transition-colors"
            >
              Reset Prompt
            </button>
          </Rise>

          <Rise>
            <div className="relative min-h-[360px] rounded-2xl border border-dashed border-black/15 bg-black/[0.02] p-6">
              <p className="text-xs font-semibold text-foreground/40 text-center pt-8">
                [Dashboard Content Area Simulation]
              </p>

              <AnimatePresence>
                {promptOpen && (
                  <motion.div
                    initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 20, filter: "blur(8px)", scale: 0.97 }}
                    animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0, filter: "blur(0px)", scale: 1 }}
                    exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 12, filter: "blur(6px)", scale: 0.97 }}
                    transition={{ duration: 0.5, ease: [0.2, 0.7, 0.2, 1] }}
                    className="absolute bottom-6 right-6 z-10 w-[340px] sm:w-[360px]"
                  >
                    <div className="relative rounded-2xl border border-black/[0.06] bg-white px-6 py-5 shadow-lg shadow-black/[0.06]">
                      {/* Close button */}
                      <button
                        type="button"
                        onClick={() => setPromptOpen(false)}
                        aria-label="Close"
                        className="absolute right-3.5 top-3.5 flex h-7 w-7 items-center justify-center rounded-full text-foreground/40 transition-colors hover:bg-black/5 hover:text-foreground/80"
                      >
                        <X className="h-4 w-4" />
                      </button>

                      {promptSubmitted ? (
                        /* ── Thank-you state ─────────────────────────────────── */
                        <div className="flex flex-col items-center gap-2 py-3 pr-2">
                          <span className="text-2xl" role="img" aria-label="Thank you">
                            🙏
                          </span>
                          <p className="text-sm font-bold text-foreground/80">
                            Thanks for your feedback!
                          </p>
                          <p className="text-xs text-foreground/50">
                            We&apos;ll use it to make 180Connect better.
                          </p>
                        </div>
                      ) : (
                        <>
                          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/40">
                            Quick feedback
                          </p>
                          <h3 className="mt-1.5 text-base font-extrabold tracking-tight text-foreground/90">
                            How&apos;s your experience?
                          </h3>
                          <p className="mt-1 text-xs leading-[1.6] text-foreground/50">
                            Rate your experience so far.
                          </p>

                          <div className="mt-4 flex justify-center">
                            <FaceRating
                              value={promptRating}
                              onValueChange={setPromptRating}
                              labels={RATING_LABELS as unknown as [string, string, string, string, string]}
                              size="md"
                            />
                          </div>

                          <div className="mt-4">
                            <textarea
                              value={promptComment}
                              onChange={(e) => setPromptComment(e.target.value)}
                              placeholder="Anything else? (optional)"
                              maxLength={280}
                              rows={2}
                              className="w-full resize-none rounded-xl border border-black/[0.08] bg-[#f4f4ef]/60 px-3 py-2 text-sm leading-[1.6] text-foreground/80 placeholder:text-foreground/30 focus:border-black/15 focus:outline-none"
                            />
                          </div>

                          <div className="mt-4 flex items-center justify-between gap-3">
                            <button
                              type="button"
                              onClick={() => setPromptOpen(false)}
                              className="rounded-full px-3 py-1.5 text-xs font-medium text-foreground/45 transition-colors hover:bg-black/[0.04] hover:text-foreground/75"
                            >
                              Not now
                            </button>
                            <OriginButton
                              type="button"
                              onClick={handlePromptSubmit}
                              disabled={promptRating === 0}
                              size="sm"
                              variant="default"
                            >
                              Send feedback
                            </OriginButton>
                          </div>
                        </>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </Rise>
        </Group>

        {/* Section 3: Admin Overview Showcase */}
        <Group className="space-y-4">
          <Rise>
            <h2 className="text-lg font-bold tracking-tight text-foreground">
              3. Admin Summary & Feed Preview
            </h2>
            <p className="text-xs text-foreground/50">
              How the collected feedback looks in the admin dashboard.
            </p>
          </Rise>

          <Rise>
            <div className="rounded-2xl border border-black/[0.06] bg-white px-6 py-5 shadow-sm">
              <div className="flex flex-wrap items-center gap-x-10 gap-y-4">
                <div className="flex items-center gap-3">
                  <span className="text-3xl">{avg !== null ? RATING_EMOJI[Math.round(avg) - 1] : "—"}</span>
                  <div>
                    <p className="text-2xl font-extrabold tabular-nums tracking-tight">
                      {avg !== null ? avg.toFixed(1) : "—"}
                    </p>
                    <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/40">
                      {MOCK_SUBMISSIONS.length} responses
                    </p>
                  </div>
                </div>

                <div className="flex flex-1 items-end gap-1.5" style={{ minWidth: 180 }}>
                  {distribution.map((count, i) => (
                    <div key={i} className="flex flex-1 flex-col items-center gap-1">
                      <div
                        className="w-full rounded-md"
                        style={{
                          height: Math.max(4, (count / maxCount) * 40),
                          backgroundColor: count > 0
                            ? ["#f43f5e", "#f97316", "#fbbf24", "#84cc16", "#10b981"][i]
                            : "rgba(0,0,0,0.06)",
                        }}
                      />
                      <span className="text-[10px] font-medium text-foreground/40">
                        {RATING_LABELS[i]}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </Rise>

          <div className="space-y-2.5">
            {MOCK_SUBMISSIONS.map((entry) => (
              <Rise key={entry.id}>
                <div className="rounded-2xl border border-black/[0.06] bg-white px-5 py-4 shadow-sm">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <span className="text-2xl" role="img" aria-label={RATING_LABELS[entry.rating - 1]}>
                        {RATING_EMOJI[entry.rating - 1]}
                      </span>
                      <div>
                        <p className="text-sm font-bold text-foreground/80">
                          {entry.author}
                        </p>
                        <p className="text-xs text-foreground/40">
                          {entry.time} · <span className="text-foreground/25">{entry.context}</span>
                        </p>
                      </div>
                    </div>
                    <span
                      className="shrink-0 rounded-full px-2.5 py-0.5 text-xs font-bold tabular-nums"
                      style={{
                        color: ["#f43f5e", "#f97316", "#d97706", "#65a30d", "#059669"][entry.rating - 1],
                        backgroundColor: ["#f43f5e", "#f97316", "#d97706", "#65a30d", "#059669"].map(c => c + "12")[entry.rating - 1],
                      }}
                    >
                      {entry.rating}/5
                    </span>
                  </div>
                  {entry.comment && (
                    <p className="mt-3 border-t border-black/[0.04] pt-3 text-sm leading-[1.7] text-foreground/60">
                      {entry.comment}
                    </p>
                  )}
                </div>
              </Rise>
            ))}
          </div>
        </Group>
      </Stage>
    </div>
  );
}
