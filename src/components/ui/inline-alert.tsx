/**
 * F236. The one place error and status messages are styled across the app.
 * `variant="page"` is the rounded card style (shadcn `--destructive`, `--brand`, etc.).
 * `variant="inline"` is the standard inline text style.
 *
 * `tone` controls the semantic style and accessibility role:
 * - "error" (default): role="alert", destructive styling
 * - "success": role="status", brand styling
 * - "warning": role="status", amber styling
 * - "neutral": role="status", muted styling
 *
 * `message` is always a pre-written human string — never pass an Error or a raw
 * API body through unstripped.
 */
export type AlertTone = "error" | "success" | "warning" | "neutral";
export type AlertVariant = "page" | "inline";

const TONE_STYLES: Record<AlertTone, { page: string; inline: string }> = {
  error: {
    page: "rounded-2xl border border-destructive/20 bg-destructive/[0.06] px-5 py-4 text-sm font-bold text-destructive",
    inline: "text-sm font-bold text-destructive",
  },
  success: {
    page: "rounded-2xl border border-brand/20 bg-brand/[0.06] px-5 py-4 text-sm font-bold text-brand",
    inline: "text-sm font-bold text-brand",
  },
  warning: {
    page: "rounded-2xl border border-amber-500/20 bg-amber-500/[0.06] px-5 py-4 text-sm font-bold text-amber-700",
    inline: "text-sm font-bold text-amber-700",
  },
  neutral: {
    page: "rounded-2xl border border-black/10 bg-black/[0.03] px-5 py-4 text-sm font-bold text-foreground/70",
    inline: "text-sm font-bold text-foreground/70",
  },
};

export function InlineAlert({
  message,
  tone = "error",
  variant = "inline",
  className = "",
}: {
  message: string;
  tone?: AlertTone;
  variant?: AlertVariant;
  className?: string;
}) {
  const styleClass = TONE_STYLES[tone][variant];
  const role = tone === "error" ? "alert" : "status";

  return (
    <p role={role} className={`${styleClass} ${className}`}>
      {message}
    </p>
  );
}
