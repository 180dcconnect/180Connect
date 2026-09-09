"use client";

import React from "react";
import type { LucideIcon } from "lucide-react";

export interface SendButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  label?: string;
  /** Optional leading icon, shown before the label. */
  icon?: LucideIcon;
  /** Swaps the label for "Sending…", freezes the plane, and blocks input. */
  pending?: boolean;
  /** Label shown while `pending`. */
  pendingLabel?: string;
  /**
   * Surface. `ink` is the original charcoal glass — the outreach review
   * panel's send, and the default, so that placement is untouched. `lead`
   * is the app's structural navy, for placements sitting on light glass
   * where charcoal reads as a hole.
   */
  tone?: "ink" | "lead";
  /** Corner treatment. `pill` is the original; `lg` squares it off to 8px. */
  radius?: "pill" | "lg";
}

/**
 * The send action — a pill whose paper plane flies off as the label slides out
 * behind it. Spent on the one real "this leaves the building" moment in the app
 * (the outreach review panel's send), and nowhere else: the effect only means
 * something if it is rare. Everything else is `OriginButton`.
 *
 * Three departures from the component this started life as:
 *
 * - **No styled-components.** It was the only production file importing it, and
 *   this app has no SSR registry for it on the App Router, so its styles were
 *   injected client-side only and the button flashed unstyled on first paint.
 *   The choreography now lives in `globals.css`, keyed off the `group/send`
 *   class and the `data-pending` attribute below — see the comment there for why
 *   it is plain CSS rather than Tailwind `group-hover:` utilities.
 * - **Not blue.** The original shipped `bg-blue-600 rounded-2xl`, which belongs
 *   to no palette in this app. It now wears `OriginButton`'s resting surface —
 *   charcoal glass, white rim, inner lip — at the same `md` metrics, so it reads
 *   as a member of the button family rather than a transplant.
 * - **It has a pending state.** Sending is a network round trip that can fail;
 *   a button whose only states are "idle" and "hovered" cannot say so.
 */
const Button = ({
  label = "Send",
  icon,
  pending = false,
  pendingLabel = "Sending…",
  tone = "ink",
  radius = "pill",
  className = "",
  type = "button",
  disabled,
  ...props
}: SendButtonProps) => {
  const surface =
    tone === "lead"
      ? "bg-lead text-white ring-white/20 hover:bg-[#1b3160]"
      : "bg-[#1c1a18]/85 text-[#f4f4ef] ring-white/25 hover:bg-[#1c1a18]";
  const corners = radius === "lg" ? "rounded-lg" : "rounded-full";

  return (
    <button
      type={type}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      data-pending={pending ? "" : undefined}
      className={`group/send relative inline-flex h-10 cursor-pointer touch-manipulation items-center justify-center gap-2 overflow-hidden ${corners} ${surface} px-5 text-sm font-semibold tracking-[-0.02em] ring-1 shadow-xs shadow-[inset_0_1px_0_rgba(255,255,255,0.3)] backdrop-blur-md transition-colors duration-200 select-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 ${className}`}
      {...props}
    >
      {typeof icon === "function" && (
        <span className="shrink-0">
          {icon({ "aria-hidden": true, className: "size-4" })}
        </span>
      )}
      <span className="send-plane flex items-center" aria-hidden="true">
        <svg
          aria-hidden="true"
          className="send-flight"
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          width={20}
          height={20}
        >
          <path fill="none" d="M0 0h24v24H0z" />
          <path
            fill="currentColor"
            d="M1.946 9.315c-.522-.174-.527-.455.01-.634l19.087-6.362c.529-.176.832.12.684.638l-5.454 19.086c-.15.529-.455.547-.679.045L12 14l6-8-8 6-8.054-2.685z"
          />
        </svg>
      </span>
      <span className={`send-label${icon ? " ml-2" : ""}`}>{pending ? pendingLabel : label}</span>
    </button>
  );
};

export { Button as SendButton };
export default Button;
