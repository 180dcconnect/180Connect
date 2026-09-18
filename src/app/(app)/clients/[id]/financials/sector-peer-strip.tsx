import { formatGbp } from "@/lib/income-band";
import {
  logPosition,
  MIN_PEERS_FOR_PERCENTILE,
  type SectorPeerStats,
} from "@/lib/financials/sector-peers";

/**
 * How big this client is *for its sector* — the same-sector clients we hold,
 * with this one marked among them.
 *
 * **Why this earns a place at all.** "£420,000" is a number nobody can size
 * without a second number beside it. It is large for a community development
 * charity and small for a housing association, and the record has never said
 * which. This is the one addition to the tab that needs no new register data:
 * it runs on `sector` and one income figure, both of which every filed client
 * already has.
 *
 * **What was wrong with the first version.** It was a bare box plot, and it read
 * as one to nobody who had not been taught to read one. Two specific faults, and
 * both are fixed by labelling rather than by drawing something else:
 *
 *   1. *Nothing said what the marks were.* A grey box, a thin line inside it and
 *      a blue bar, on a track with two money figures at the ends. The box is the
 *      middle half and the line is the median — which the reader now gets told,
 *      in those words, under the track. A chart that needs a statistics course
 *      is a chart that is not communicating.
 *   2. *The axis and the sentence measured different things.* The track is a
 *      money axis; "larger than 68%" is a rank. So a client could sit visually
 *      near the left and be told it beat two thirds of the sector, which reads
 *      as a contradiction and is not one. The two are now separated on purpose:
 *      the track is labelled as money and carries this client's own figure on
 *      its marker, and the rank is a sentence underneath that never pretends to
 *      be a position on the line.
 *
 * **Log scale.** Charity income in one sector spans four orders of magnitude. On
 * a linear axis every client under £1m lands in the leftmost 3% of the track,
 * which draws the largest charity rather than the distribution.
 *
 * **Whiskers are the true min and max**, not 1.5 IQR: with a peer set this
 * skewed, Tukey fences would hide the £40m outlier that is the single most
 * useful thing here for a reader sizing "big".
 *
 * **What it refuses to say.** Not "bigger than 68% of the sector" — bigger than
 * 68% of *the clients we hold* in that sector, which is a set assembled by our
 * own import criteria and nobody's idea of a random sample. The count is printed
 * every time, and under `MIN_PEERS_FOR_PERCENTILE` peers the percentile is
 * withheld rather than dressed up. See `sector-peers.ts`.
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
  const at = (value: number) => logPosition(value, floor, ceiling) * 100;

  const boxLeft = at(quartiles.p25);
  const boxRight = at(quartiles.p75);
  const medianAt = at(quartiles.median);
  const ownAt =
    income !== null && Number.isFinite(income) ? at(income) : null;

  // A label anchored at 0% or 100% would hang off the track, so the ones that
  // ride a mark switch from centred to edge-aligned near the ends.
  const anchor = (position: number) =>
    position < 12
      ? { left: "0%", transform: "none" }
      : position > 88
        ? { right: "0%", transform: "none" }
        : { left: `${position}%`, transform: "translateX(-50%)" };

  return (
    <div className="mt-4 border-t border-rule-soft pt-3.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="text-[12.5px] text-dim">
          Size against <span className="text-ink">{sector}</span> clients on record
        </span>
        <span className="font-mono text-[11.5px] text-faint tabular-nums">
          {peerCount} {peerCount === 1 ? "client" : "clients"}
        </span>
      </div>

      {/* This client's own figure, on its own marker — so the track can be read
          as what it is (a money axis) without the reader having to map a
          position back to a number. */}
      <div className="relative mt-3 h-4">
        {ownAt !== null && (
          <span
            className="absolute top-0 font-mono text-[11px] leading-none font-semibold whitespace-nowrap text-lead tabular-nums"
            style={anchor(ownAt)}
          >
            {formatGbp(income)}
          </span>
        )}
      </div>

      <div className="relative h-6">
        {/* The full range, end to end. */}
        <div aria-hidden="true" className="absolute top-[11px] right-0 left-0 h-px bg-rule" />
        {/* End caps, so the track reads as bounded rather than trailing off. */}
        <div aria-hidden="true" className="absolute top-[6px] left-0 h-[11px] w-px bg-rule" />
        <div aria-hidden="true" className="absolute top-[6px] right-0 h-[11px] w-px bg-rule" />

        {/* The middle half. */}
        <div
          aria-hidden="true"
          className="absolute top-[5px] h-[13px] rounded-[2px] bg-paper-sunk"
          style={{ left: `${boxLeft}%`, width: `${Math.max(boxRight - boxLeft, 0.4)}%` }}
        />
        {/* The median. */}
        <div
          aria-hidden="true"
          className="absolute top-[5px] h-[13px] w-px bg-faint"
          style={{ left: `${medianAt}%` }}
        />

        {ownAt !== null && (
          <div
            aria-hidden="true"
            className="absolute top-[1px] h-[21px] w-[3px] -translate-x-[1px] rounded-full bg-lead"
            style={{ left: `${ownAt}%` }}
          />
        )}
      </div>

      {/* The three reference values, each under the mark it belongs to. */}
      <div className="relative mt-1 h-4">
        <span className="absolute top-0 left-0 font-mono text-[10.5px] leading-none text-faint tabular-nums">
          {formatGbp(quartiles.min)}
        </span>
        <span
          className="absolute top-0 font-mono text-[10.5px] leading-none whitespace-nowrap text-faint tabular-nums"
          style={anchor(medianAt)}
        >
          median {formatGbp(quartiles.median)}
        </span>
        <span className="absolute top-0 right-0 font-mono text-[10.5px] leading-none text-faint tabular-nums">
          {formatGbp(quartiles.max)}
        </span>
      </div>

      {/* Said in words, because the drawing above cannot say it and every reader
          who has not been taught box plots was guessing. */}
      <p className="mt-2 text-[11.5px] leading-[1.5] text-faint">
        The line runs from the smallest to the largest of these clients. The
        shaded block is the middle half of them, and the notch in it is the
        median.
      </p>

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
            This client is larger than{" "}
            <span className="font-medium text-ink">{Math.round(percentile * 100)}%</span> of
            the {peerCount} {sector} {peerCount === 1 ? "client" : "clients"} we hold.
          </>
        )}
      </p>
    </div>
  );
}
