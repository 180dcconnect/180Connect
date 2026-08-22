/**
 * F235. A genuinely empty, successfully-loaded list — never styled like a
 * failure (InlineAlert owns red/destructive; this stays neutral ink-on-white).
 * `message` should say which of the two things is true: nothing exists yet,
 * or nothing matches the current filter — those are different states and
 * read differently to the person looking at them.
 */
export function EmptyState({
  message,
  className = "",
}: {
  message: string;
  className?: string;
}) {
  return (
    <div
      className={`rounded-2xl border border-black/[0.06] bg-white px-5 py-10 text-center shadow-sm ${className}`}
    >
      <p className="text-sm leading-[1.7] text-foreground/65">{message}</p>
    </div>
  );
}
