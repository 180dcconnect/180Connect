"use client";

import { useReducedMotionConfig, motion } from "motion/react";

export type MentionTagProps = {
  text: string;
  variant?: "dark" | "light";
  animate?: boolean;
  className?: string;
  /**
   * Composer-overlay mode: the highlight sits exactly under a transparent
   * textarea, so every glyph must occupy the same width as the textarea's
   * plain text or the caret drifts away from what the author sees (typing
   * appears a letter ahead of the caret once a mention is in the draft).
   * Skips the semibold weight — bold advances are wider than the regular
   * text the textarea renders — and keeps the insertion animation to
   * opacity/colour on plain inline spans. No inline-block, no y-lift, no
   * NBSP substitution: all three change line-breaking and advance widths
   * versus the textarea. Read-only uses (saved notes, previews) leave this
   * off — with no caret to track, they keep the semibold treatment.
   */
  matchTextarea?: boolean;
};

/**
 * Signature 180Connect Mention Tag:
 * Highlights @mentions purely through lime text (no background pill, no border),
 * with an optional subtle, tidy letter-by-letter lift wave animation upon insertion.
 *
 * - Dark variant: for frosted glass and dark surfaces (e.g. BulkActionsBar),
 *   styled in signature #e6f5c0 lime text.
 * - Light variant: for white/paper cards (e.g. AddNoteForm, NotesSection),
 *   styled in crisp, readable lime text (text-lime-700 / #4d7c0f).
 */
export function MentionTag({
  text,
  variant = "dark",
  animate = false,
  className = "",
  matchTextarea = false,
}: MentionTagProps) {
  const reducedMotion = useReducedMotionConfig();
  const shouldAnimate = animate && !reducedMotion;

  const isDark = variant === "dark";
  const targetColor = isDark ? "#e6f5c0" : "#4d7c0f";
  const initialColor = isDark ? "#ffffff" : "#141a22";
  const textClass = isDark ? "text-[#e6f5c0]" : "text-lime-700";
  // Overlay glyphs must measure exactly like the textarea's regular text —
  // only colour may differ, never weight or display.
  const weightClass = matchTextarea ? "" : "font-semibold";

  if (!shouldAnimate) {
    return (
      <span className={`inline ${weightClass} ${textClass} ${className}`}>
        {text}
      </span>
    );
  }

  if (matchTextarea) {
    // Layout-neutral insertion shimmer: per-character stagger on opacity and
    // colour only. Spans stay inline with their original spaces, so wrapping
    // and advances match the textarea character-for-character.
    const chars = text.split("");

    return (
      <span className={`inline ${textClass} ${className}`}>
        {chars.map((char, index) => (
          <motion.span
            key={index}
            className="inline"
            initial={{
              opacity: 0.65,
              color: initialColor,
            }}
            animate={{
              opacity: 1,
              color: targetColor,
            }}
            transition={{
              opacity: {
                duration: 0.18,
                ease: "easeOut",
                delay: index * 0.012,
              },
              color: {
                duration: 0.25,
                ease: "easeOut",
                delay: index * 0.012,
              },
            }}
          >
            {char}
          </motion.span>
        ))}
      </span>
    );
  }

  const chars = text.split("");

  return (
    <span className={`inline font-semibold ${textClass} ${className}`}>
      {chars.map((char, index) => (
        <motion.span
          key={index}
          className="inline-block align-baseline"
          initial={{
            y: 2,
            opacity: 0.65,
            color: initialColor,
          }}
          animate={{
            y: 0,
            opacity: 1,
            color: targetColor,
          }}
          transition={{
            y: {
              duration: 0.22,
              ease: [0.16, 1, 0.3, 1],
              delay: index * 0.012,
            },
            opacity: {
              duration: 0.18,
              ease: "easeOut",
              delay: index * 0.012,
            },
            color: {
              duration: 0.25,
              ease: "easeOut",
              delay: index * 0.012,
            },
          }}
        >
          {char === " " ? "\u00A0" : char}
        </motion.span>
      ))}
    </span>
  );
}
