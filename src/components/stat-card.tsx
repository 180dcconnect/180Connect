/**
 * F021/F022-F025 — a single platform-wide dashboard metric tile.
 *
 * The number is the tile. Label and caption are 11px, the value is 36px/900 —
 * the design system's "big type, small chrome" jump, with nothing in between.
 *
 * The meter is the only reason to look twice: it shows the count as a share of
 * the pipeline, which is what makes "412 contacted" mean something without a
 * second number beside it. Exactly one tile per screen may set `emphasis` and
 * take the brand green — one accent, one place. Every other meter is ink, so
 * the green fill reads as "this is the one that matters" rather than as the
 * colour all meters happen to be.
 */
export function StatCard({
  label,
  value,
  share,
  caption,
  emphasis = false,
}: {
  label: string;
  value: number;
  /** 0–1. Drives the meter width only; the caption states it in words. */
  share: number;
  caption: string;
  emphasis?: boolean;
}) {
  const width = `${Math.round(Math.min(Math.max(share, 0), 1) * 100)}%`;

  return (
    <div className="rounded-2xl border border-black/[0.06] bg-white p-5 shadow-sm">
      <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/40">
        {label}
      </p>
      <p className="mt-3 text-[2.25rem] font-black leading-none tracking-[-0.03em] tabular-nums">
        {value.toLocaleString()}
      </p>
      <div
        aria-hidden="true"
        className="mt-4 h-1 w-full overflow-hidden rounded-full bg-black/[0.07]"
      >
        <div
          className={`h-full rounded-full ${emphasis ? "bg-brand" : "bg-black/25"}`}
          style={{ width }}
        />
      </div>
      <p className="mt-2 text-[11px] text-foreground/40">{caption}</p>
    </div>
  );
}
