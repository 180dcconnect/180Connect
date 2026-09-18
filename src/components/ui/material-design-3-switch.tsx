"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { Check, X } from "lucide-react";

/**
 * An instant on/off switch, in Material Design 3's physics and the app's own
 * colours.
 *
 * ── When to use this, and when not to ──
 *
 * A switch says "this is on, and flipping it is immediate". Use it where the
 * flip *is* the save — a protection going on or off, a setting that applies at
 * once. Where the answer is part of a form that is submitted later, use
 * `FiledCheckbox` instead: two controls that both look like "on/off" but mean
 * different things is how a settings screen starts lying to people. This one
 * renders a real checkbox input, hidden and driven by the track beside it, so
 * Space and the label both toggle it and its state is announced as a switch.
 *
 * ── The colours are the app's, not Material's ──
 *
 * The track is `--paper-sunk` when off and the variant's tone when on, the knob
 * is white, and the halo that grows under the pointer is the same tone at 5–10%
 * — so nothing here reaches into the stock M3 or shadcn palettes and the switch
 * sits on a Filed Record card without looking pasted on. `variant` names the
 * *on* colour: `primary` is `--lead` (the accent), `success` is `--go`, and
 * `destructive` is `--stop` — the one to reach for when turning the switch off
 * is the risky direction, which is why the colour is on the "on" state: it is
 * the live thing the reader is about to disarm.
 *
 * ── The knob that morphs ──
 *
 * M3's switch does not just slide: the knob grows when it is pressed, grows
 * again when it carries an icon, and the icon itself rotates in. That is all
 * here, including the attention-drawing halo, because it is the part of the
 * control that tells you the press landed.
 *
 * `haptic` plays a synthesised click through the Web Audio API for screens that
 * want one. It is off by default and the app does not turn it on anywhere: an
 * admin tool that makes a noise is a surprise in a shared office, and a
 * setting's state should never depend on the sound card.
 */
export type SwitchVariant = "primary" | "destructive" | "success";

const switchVariants = cva(
  "peer inline-flex shrink-0 cursor-pointer items-center rounded-full border-2 border-rule bg-paper-sunk transition-colors duration-300 disabled:cursor-not-allowed disabled:opacity-50",
  {
    variants: {
      variant: {
        primary: "peer-checked:border-lead peer-checked:bg-lead",
        destructive: "peer-checked:border-stop peer-checked:bg-stop",
        success: "peer-checked:border-go peer-checked:bg-go",
      },
      size: {
        default: "h-8 w-[52px]", // Standard M3
        sm: "h-6 w-10", // Compact
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "default",
    },
  },
);

/** M3's spring, named so the transform can ease into it rather than linearly. */
const SWITCH_THEME = {
  "--ease-spring": "cubic-bezier(0.175, 0.885, 0.32, 1.275)",
} as React.CSSProperties;

/**
 * The knob's icon and halo per variant. The track's own colour lives in
 * `switchVariants` above — that is where tailwind-merge has to be able to reach
 * it — and these are the two pieces of the same tone painted on top of it.
 */
const VARIANT_TONES: Record<SwitchVariant, { onIcon: string; halo: string }> = {
  primary: { onIcon: "text-lead", halo: "bg-lead" },
  destructive: { onIcon: "text-stop", halo: "bg-stop" },
  success: { onIcon: "text-go", halo: "bg-go" },
};

// --- AUDIO HAPTIC ENGINE ---
const playHapticFeedback = (type: "heavy" | "light" | "none") => {
  if (type === "none" || typeof window === "undefined") return;

  try {
    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;

    const ctx = new AudioContextClass();
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);

    const now = ctx.currentTime;

    if (type === "heavy") {
      oscillator.type = "triangle";
      oscillator.frequency.setValueAtTime(180, now);
      oscillator.frequency.exponentialRampToValueAtTime(40, now + 0.15);

      gainNode.gain.setValueAtTime(0.4, now);
      gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.12);

      oscillator.start(now);
      oscillator.stop(now + 0.15);
    } else {
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(800, now);

      gainNode.gain.setValueAtTime(0.15, now);
      gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.08);

      oscillator.start(now);
      oscillator.stop(now + 0.08);
    }

    // One context per click, closed when the sound ends: browsers cap how many
    // can exist at once, so a switch somebody flips twenty times would silence
    // itself permanently if these were left open.
    oscillator.onended = () => void ctx.close();
  } catch (e) {
    console.error("Audio haptic failed", e);
  }
};

export interface SwitchProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size">,
    VariantProps<typeof switchVariants> {
  onCheckedChange?: (checked: boolean) => void;
  showIcons?: boolean;
  checkedIcon?: React.ReactNode; // Custom Icon for On State
  uncheckedIcon?: React.ReactNode; // Custom Icon for Off State
  haptic?: "heavy" | "light" | "none";
}

const Switch = React.forwardRef<HTMLInputElement, SwitchProps>(
  (
    {
      className,
      size,
      variant,
      checked,
      defaultChecked,
      onCheckedChange,
      showIcons = false,
      checkedIcon,
      uncheckedIcon,
      haptic = "none",
      style,
      disabled,
      ...props
    },
    ref,
  ) => {
    const [uncontrolledChecked, setIsChecked] = React.useState(defaultChecked ?? false);
    // Controlled when the caller passes `checked`: the visual follows their
    // state, so a switch that opens a confirmation stays visibly on until the
    // decision is made rather than flipping itself hopefully.
    const isChecked = checked ?? uncontrolledChecked;
    const [isPressed, setIsPressed] = React.useState(false);
    const [isHovered, setIsHovered] = React.useState(false);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      if (disabled) return;
      const newValue = e.target.checked;

      playHapticFeedback(haptic);

      if (checked === undefined) {
        setIsChecked(newValue);
      }
      onCheckedChange?.(newValue);
    };

    // Size Calcs
    const isSmall = size === "sm";
    const tone = VARIANT_TONES[variant ?? "primary"];
    const translateDist = isSmall ? "translate-x-[16px]" : "translate-x-[20px]";
    const handleSizeUnchecked = isSmall ? "w-3 h-3 ml-[2px]" : "w-4 h-4 ml-[2px]";
    const handleSizeChecked = isSmall ? "w-4 h-4" : "w-6 h-6";
    const handleSizePressed = isSmall ? "w-5 h-5 -ml-[2px]" : "w-7 h-7 -ml-[2px]";

    // Icon sizing classes
    const iconClasses = isSmall ? "w-2.5 h-2.5" : "w-3.5 h-3.5";

    // Logic to determine if we render any icons
    const shouldRenderIcons = showIcons || checkedIcon || uncheckedIcon;

    return (
      <label
        className={cn(
          "group relative inline-flex items-center justify-center",
          disabled && "cursor-not-allowed opacity-50",
          "min-w-[48px] min-h-[48px]",
        )}
        style={{ ...SWITCH_THEME, ...style }}
        onPointerDown={() => !disabled && setIsPressed(true)}
        onPointerUp={() => setIsPressed(false)}
        onPointerLeave={() => {
          setIsPressed(false);
          setIsHovered(false);
        }}
        onPointerEnter={() => !disabled && setIsHovered(true)}
      >
        <input
          type="checkbox"
          className="peer sr-only"
          ref={ref}
          checked={isChecked}
          onChange={handleChange}
          disabled={disabled}
          {...props}
        />

        {/* --- TRACK --- */}
        <div
          className={cn(
            switchVariants({ variant, size }),
            // The ring is on the track, not the hidden input: the input is
            // `sr-only`, so a focus ring drawn on it would be invisible.
            "peer-focus-visible:ring-2 peer-focus-visible:ring-lead/30 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-white",
            className,
          )}
        >
          {/* --- HANDLE CONTAINER --- */}
          <div
            className={cn(
              "pointer-events-none block h-full w-full transition-all duration-300 ease-[var(--ease-spring)]",
              isChecked ? translateDist : "translate-x-0",
            )}
          >
            {/* --- HANDLE --- */}
            <div
              className={cn(
                "absolute top-1/2 -translate-y-1/2 transition-all duration-300 flex items-center justify-center rounded-full left-[2px]",

                isChecked ? "bg-white" : "bg-white text-faint",
                isChecked && tone.onIcon,

                isPressed
                  ? handleSizePressed
                  : isChecked || (shouldRenderIcons && !isSmall)
                    ? handleSizeChecked
                    : handleSizeUnchecked,
              )}
            >
              {/* --- ICONS RENDERING --- */}
              {shouldRenderIcons && (
                <div className="relative w-full h-full flex items-center justify-center overflow-hidden">
                  {/* CHECKED STATE ICON */}
                  <div
                    className={cn(
                      "absolute inset-0 flex items-center justify-center transition-all duration-300",
                      isChecked ? "opacity-100 scale-100 rotate-0" : "opacity-0 scale-50 -rotate-45",
                    )}
                  >
                    {checkedIcon ? (
                      checkedIcon
                    ) : (
                      <Check className={iconClasses} strokeWidth={4} />
                    )}
                  </div>

                  {/* UNCHECKED STATE ICON */}
                  <div
                    className={cn(
                      "absolute inset-0 flex items-center justify-center transition-all duration-300 text-faint",
                      !isChecked ? "opacity-100 scale-100 rotate-0" : "opacity-0 scale-50 rotate-45",
                    )}
                  >
                    {uncheckedIcon ? (
                      uncheckedIcon
                    ) : (
                      <X className={iconClasses} strokeWidth={4} />
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* --- HALO --- */}
            <div
              className={cn(
                "absolute top-1/2 left-[2px] -translate-y-1/2 -translate-x-1/2 rounded-full pointer-events-none transition-all duration-200",
                isSmall ? "w-8 h-8" : "w-10 h-10",
                isChecked ? tone.halo : "bg-faint",
                isPressed ? "opacity-10 scale-100" : isHovered ? "opacity-5 scale-100" : "opacity-0 scale-50",
                isChecked ? "left-[14px]" : shouldRenderIcons && !isSmall ? "left-[14px]" : "left-[10px]",
                isSmall && (isChecked ? "left-[10px]" : "left-[8px]"),
              )}
            />
          </div>
        </div>
      </label>
    );
  },
);
Switch.displayName = "Switch";

export { Switch };
