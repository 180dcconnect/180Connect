"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";

/**
 * The draft as it streams in: subject, then the body word by word, each word
 * resolving out of a blur as it lands — the landing-page reveal, applied to
 * generated text.
 *
 * Rendered only once every thinking tick is ticked (callers gate on the
 * display stage reaching "saving"), so the reveal never overlaps the
 * thinking indicator. Only the leading edge animates: settled words are
 * plain text, the newest handful carry the blur. Keyed by absolute token
 * index, so a word animates exactly once no matter how the stream chunks.
 */

const TICK_MS = 60;
const TOKENS_PER_TICK = 3;
const ANIMATED_TAIL = 8;

export function StreamingDraftText({
  subject,
  body,
  streaming,
  onRevealComplete,
}: {
  subject: string;
  body: string;
  streaming: boolean;
  /** Fires once, when the last word has resolved — the caller's cue to hand
      over to the review editor. */
  onRevealComplete?: () => void;
}) {
  const reducedMotion = useReducedMotion();
  const tokens = useMemo(
    () => body.split(/(\s+)/).filter((token) => token.length > 0),
    [body],
  );
  const [revealed, setRevealed] = useState(0);
  const completedRef = useRef(false);

  useEffect(() => {
    if (reducedMotion) return;
    if (revealed >= tokens.length) return;
    const timer = setTimeout(() => {
      setRevealed((current) => Math.min(current + TOKENS_PER_TICK, tokens.length));
    }, TICK_MS);
    return () => clearTimeout(timer);
  }, [reducedMotion, revealed, tokens.length]);

  useEffect(() => {
    if (completedRef.current || tokens.length === 0) return;
    if (!reducedMotion && revealed < tokens.length) return;
    completedRef.current = true;
    onRevealComplete?.();
  }, [revealed, tokens.length, reducedMotion, onRevealComplete]);

  if (reducedMotion) {
    return (
      <div aria-live="polite" className="mt-4">
        {subject.trim() && <p className="text-sm font-bold text-foreground">{subject}</p>}
        {body.trim() && (
          <p className="mt-2 whitespace-pre-wrap text-[13px] leading-6 text-slate-800">{body}</p>
        )}
        {streaming && <span className="mt-2 inline-block h-4 w-1.5 bg-lead/60" aria-hidden="true" />}
      </div>
    );
  }

  const visible = tokens.slice(0, revealed);
  const settled = visible.slice(0, Math.max(0, visible.length - ANIMATED_TAIL));
  const tail = visible.slice(Math.max(0, visible.length - ANIMATED_TAIL));
  const tailOffset = revealed - tail.length;

  return (
    <div aria-live="polite" className="mt-4">
      {subject.trim() && (
        <motion.p
          key="streaming-subject"
          initial={{ opacity: 0, filter: "blur(8px)", y: 6 }}
          animate={{ opacity: 1, filter: "blur(0px)", y: 0 }}
          transition={{ duration: 0.45, ease: "easeOut" }}
          className="text-sm font-bold text-foreground"
        >
          {subject}
        </motion.p>
      )}
      {visible.length > 0 && (
        <p className="mt-2 whitespace-pre-wrap text-[13px] leading-6 text-slate-800">
          {settled.join("")}
          {tail.map((token, index) => (
            <motion.span
              key={tailOffset + index}
              initial={{ opacity: 0, filter: "blur(6px)" }}
              animate={{ opacity: 1, filter: "blur(0px)" }}
              transition={{ duration: 0.35, ease: "easeOut" }}
              className="inline"
            >
              {token}
            </motion.span>
          ))}
        </p>
      )}
      {(streaming || revealed < tokens.length) && (
        <motion.span
          aria-hidden="true"
          animate={{ opacity: [1, 0.2, 1] }}
          transition={{ duration: 1, repeat: Infinity, ease: "easeInOut" }}
          className="mt-2 inline-block h-4 w-1.5 rounded-full bg-lead/70"
        />
      )}
    </div>
  );
}
