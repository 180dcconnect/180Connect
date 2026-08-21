/**
 * Field styling for the auth forms, shared so the sign-in and reset panels
 * cannot drift apart — and so the dark tone is defined once rather than
 * re-derived per form.
 *
 * Pills rather than the rounded rectangles the app uses: these are public
 * surfaces and follow docs/design-system.md, not the shadcn tokens. Focus lands
 * on lime, the one accent, in both tones.
 */

export type FieldTone = "light" | "dark";

const BASE =
  "h-11 w-full rounded-full font-body text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[#e6f5c0]";

const SURFACE: Record<FieldTone, string> = {
  // Translucent white over the bone ground, so the field reads as a pane
  // rather than a cut-out.
  light:
    "border border-[#0c1014]/12 bg-white/70 text-[#0c1014] focus:border-[#0c1014]/25 focus:bg-white aria-invalid:border-red-500/60 aria-invalid:ring-2 aria-invalid:ring-red-500/15",
  // The same idea inverted: a lift off the panel rather than a hole in it.
  dark:
    "border border-white/15 bg-white/[0.06] text-[#f4f4ef] focus:border-white/30 focus:bg-white/[0.1] aria-invalid:border-red-400/60 aria-invalid:ring-2 aria-invalid:ring-red-400/20",
};

export const fieldClass = (tone: FieldTone) => `${BASE} ${SURFACE[tone]} px-5`;

/** The password field carries a reveal button inside its right edge. */
export const fieldWithAffordanceClass = (tone: FieldTone) =>
  `${BASE} ${SURFACE[tone]} pl-5 pr-12`;

export const fieldErrorClass = (tone: FieldTone) =>
  `mt-1 font-body text-xs ${tone === "dark" ? "text-red-300" : "text-red-700"}`;

export const quietLinkClass = (tone: FieldTone) =>
  `font-body text-xs underline-offset-4 transition-colors hover:underline ${
    tone === "dark"
      ? "text-[#f4f4ef]/45 hover:text-[#f4f4ef]"
      : "text-[#0c1014]/40 hover:text-[#0c1014]"
  }`;

export const iconButtonClass = (tone: FieldTone) =>
  `absolute inset-y-1 right-1 z-20 flex w-9 items-center justify-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 ${
    tone === "dark"
      ? "text-[#f4f4ef]/45 hover:text-[#f4f4ef] focus-visible:outline-[#f4f4ef]"
      : "text-[#0c1014]/40 hover:text-[#0c1014] focus-visible:outline-[#0c1014]"
  }`;

/** Inline status/error banner above a form. */
export const bannerClass = (
  tone: FieldTone,
  intent: "error" | "pending" | "success",
) => {
  const shape = "rounded-2xl border px-4 py-3 font-body text-xs leading-relaxed";
  if (tone === "dark") {
    return `${shape} ${
      intent === "error"
        ? "border-red-400/30 bg-red-400/10 text-red-200"
        : intent === "success"
          ? "border-white/15 bg-white/[0.06] text-[#f4f4ef]/80"
          : "border-amber-300/30 bg-amber-300/10 text-amber-100"
    }`;
  }
  return `${shape} ${
    intent === "error"
      ? "border-red-300/50 bg-red-50/80 text-red-700"
      : intent === "success"
        ? "border-[#0c1014]/10 bg-white/70 text-[#0c1014]/75"
        : "border-amber-300/60 bg-amber-50/80 text-amber-900"
  }`;
};

/**
 * The CSS variables the floating labels read to cut the field's top border with
 * their container's own colour. Set on the surface the fields sit on.
 */
export const fieldVars = (tone: FieldTone, notch: string) =>
  ({
    "--field-notch": notch,
    "--field-label":
      tone === "dark" ? "rgba(244,244,239,0.55)" : "rgba(12,16,20,0.5)",
    "--field-label-focus":
      tone === "dark" ? "rgba(244,244,239,0.8)" : "rgba(12,16,20,0.7)",
    "--field-placeholder":
      tone === "dark" ? "rgba(244,244,239,0.4)" : "rgba(12,16,20,0.4)",
  }) as React.CSSProperties;
