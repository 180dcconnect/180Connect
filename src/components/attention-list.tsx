import Link from "next/link";
import type { NeedsAttentionItem } from "@/lib/dashboard-metrics";

/**
 * F027 — the dashboard's Needs Attention panel: the actor's own clients whose
 * outreach has not come back yet, longest waiting first (the ordering is
 * `needsAttention`'s, not this component's).
 *
 * A card of rows rather than a bare list, so it reads as one object floating on
 * the page ground. The index is zero-padded and `tabular-nums` so every name
 * starts on the same vertical line however long the list runs, and the arrow —
 * the only moving part — nudges on hover to say the row is a link.
 */
export function AttentionList({ items }: { items: NeedsAttentionItem[] }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-black/[0.06] bg-white shadow-sm">
      {items.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-foreground/55">
          Nothing needs your attention right now.
        </p>
      ) : (
        <ul className="divide-y divide-black/[0.06]">
          {items.map((item, index) => (
            <li key={item.id}>
              <Link
                href={`/clients/${item.id}`}
                className="group flex items-center gap-4 px-5 py-4 transition-colors hover:bg-black/[0.02] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand"
              >
                <span
                  aria-hidden="true"
                  className="w-6 shrink-0 text-[11px] font-bold tabular-nums text-foreground/25"
                >
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span className="min-w-0 flex-1 truncate text-[15px] font-bold">
                  {item.legalName}
                </span>
                <span className="shrink-0 rounded-full bg-black/[0.05] px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.08em] text-foreground/55">
                  {item.outreachStatusLabel}
                </span>
                <span
                  aria-hidden="true"
                  className="shrink-0 text-foreground/25 transition-all duration-200 group-hover:translate-x-0.5 group-hover:text-foreground/55"
                >
                  →
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
