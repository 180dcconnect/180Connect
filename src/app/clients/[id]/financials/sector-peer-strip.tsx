import { formatGbp } from "@/lib/income-band";
import {
  logPosition,
  MIN_PEERS_FOR_PERCENTILE,
  type SectorPeerStats,
} from "@/lib/financials/sector-peers";

/**
 * How big this client is *for its sector* — a box plot of the same-sector
 * clients we hold, with this one marked on it.
 *
 * **Why this earns a place at all.** "£420,000" is a number nobody can size
 * without a second number beside it. It is large for a community development
 * charity and small for a housing association, and the record has never said
 * which. This is the one addition to the tab that needs no new register data:
 * it runs on `sector` and one income figure, both of which every filed client
 * already has, so it covers more of the book than the flow diagram does.
 *
 * **A box plot, not a scatter of every peer.** Three hundred dots on a 200px
 * strip is a smear; the quartile box is the same information at the size this
 * renders. The whiskers are the true min and max rather than 1.5 IQR — with a
 * peer set this skewed, Tukey fences would hide the £40m outlier that is the
 * single most useful thing on the strip for a reader sizing "big".
 *
 * **Log scale.** Charity income in one sector spans four orders of magnitude.
 * On a linear axis every client under £1m lands in the leftmost 3% of the
 * track, which draws the largest charity rather than the distribution.
 *
 * **What it refuses to say.** Not "bigger than 68% of the sector" — bigger than
 * 68% of *the clients we hold* in that sector, which is a set assembled by our
 * own import criteria and nobody's idea of a random sample. The count is
 * printed next to the percentile every time, and under
 * `MIN_PEERS_FOR_PERCENTILE` peers the percentile is withheld entirely rather
 * than dressed up: see `sector-peers.ts`.
 */
export function SectorPeerStrip({
  sector,
  income,
  stats,
}: {
  sector: string;
  income: number | null;
  stats: SectorPeerStats;
}) {
  const { quartiles, peerCount, percentile } = stats;
  if (!quartiles || peerCount === 0) return null;

  const floor = Math.max(quartiles.min, 1);
  const ceiling = Math.max(quartiles.max, floor + 1);
  const at = (value: number) => `${(logPosition(value, floor, ceiling) * 100).toFixed(2)}%`;

  const boxLeft = logPosition(quartiles.p25, floor, ceiling) * 100;
  const boxRight = logPosition(quartiles.p75, floor, ceiling) * 100;
  const ownPosition =
    income !== null && Number.isFinite(income) ? logPosition(income, floor, ceiling) * 100 : null;

  return (
    <div className="border-t border-rule-soft pt-3.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="text-[12.5px] text-dim">
          Size against{" "}
          <span className="text-ink">{sector}</span> clients on record
        </span>
        <span className="font-mono text-[11.5px] text-faint tabular-nums">
          n = {peerCount}
        </span>
      </div>

      {/* The strip. Whiskers are the real extremes; the box is the middle half. */}
      <div className="relative mt-3 h-9">
        <div
          aria-hidden="true"
          className="absolute top-[13px] right-0 left-0 h-px bg-rule"
        />
        <div
          aria-hidden="true"
          className="absolute top-[7px] h-[13px] rounded-[2px] bg-paper-sunk"
          style={{ left: `${boxLeft}%`, width: `${Math.max(boxRight - boxLeft, 0.4)}%` }}
        />
        <div
          aria-hidden="true"
          className="absolute top-[7px] h-[13px] w-px bg-faint"
          style={{ left: at(quartiles.median) }}
        />

        {ownPosition !== null && (
          <div
            aria-hidden="true"
            className="absolute top-[2px] h-[23px] w-[3px] -translate-x-[1px] rounded-full bg-lead"
            style={{ left: `${ownPosition}%` }}
          />
        )}

        <span className="absolute top-[26px] left-0 font-mono text-[10.5px] text-faint tabular-nums">
          {formatGbp(quartiles.min)}
        </span>
        <span className="absolute top-[26px] right-0 font-mono text-[10.5px] text-faint tabular-nums">
          {formatGbp(quartiles.max)}
        </span>
      </div>

      <p className="mt-1.5 text-[12px] leading-[1.5] text-dim">
        {percentile === null ? (
          peerCount < MIN_PEERS_FOR_PERCENTILE ? (
            <>
              Only {peerCount} other {sector} {peerCount === 1 ? "client" : "clients"} on
              record with a filed income — too few to place this one against.
            </>
          ) : (
            <>
              Median {sector} client on record files{" "}
              <span className="font-medium text-ink">{formatGbp(quartiles.median)}</span>.
              This client has no income figure to place against it.
            </>
          )
        ) : (
          <>
            Larger than{" "}
            <span className="font-medium text-ink">{Math.round(percentile * 100)}%</span> of
            the {peerCount} {sector} clients we hold. Median{" "}
            <span className="font-medium text-ink">{formatGbp(quartiles.median)}</span>.
          </>
        )}
      </p>
    </div>
  );
}
