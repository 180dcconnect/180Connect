"use client";

import { MIN_SAMPLE_EMAILS, type Leaderboard } from "@/lib/dashboard/cam-leaderboard";

/**
 * F212 (#207) — the whole team's CAMs in one table, with the rows that look
 * like they need support marked.
 *
 * Lives inside the Performance section rather than beside it, so it inherits
 * that section's period picker: "who is struggling" is a question about a
 * window, and a leaderboard on a different window from the tiles above it would
 * be a second, quietly disagreeing source of truth.
 *
 * Rates under the sample floor are shown greyed with a mark rather than hidden.
 * Hiding them would make a quiet CAM look like a missing row; presenting them
 * in the same weight as a well-sampled row would let 1-reply-in-3 read as a 33%
 * reply rate.
 */

function pct(value: number | null): string {
  if (value === null) return "—";
  return `${Math.round(value * 100)}%`;
}

export function CamLeaderboardTable({ board }: { board: Leaderboard }) {
  if (board.rows.length === 0) return null;

  const caption = [
    board.needsSupportCount > 0
      ? `${board.needsSupportCount} may need support`
      : null,
    board.inactiveCount > 0 ? `${board.inactiveCount} inactive` : null,
    board.medianReplyRate !== null ? `median reply ${pct(board.medianReplyRate)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="mt-4 rounded-[28px] border border-border bg-card p-6 shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="text-[16px] font-semibold tracking-tight text-foreground">
          CAM comparison
        </h3>
        <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/35">
          {caption || "Whole team"}
        </span>
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[540px] border-collapse text-[13px] tabular-nums">
          <thead>
            <tr className="border-b border-black/[0.06] text-[10px] font-bold uppercase tracking-[0.1em] text-foreground/35">
              <th scope="col" className="pb-2 text-left font-bold">CAM</th>
              <th scope="col" className="pb-2 text-right font-bold">Sent</th>
              <th scope="col" className="pb-2 text-right font-bold">Replies</th>
              <th scope="col" className="pb-2 text-right font-bold">Reply&nbsp;%</th>
              <th scope="col" className="pb-2 text-right font-bold">Conv.</th>
              <th scope="col" className="pb-2 text-right font-bold">Conv.&nbsp;%</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/[0.04]">
            {board.rows.map((row) => {
              const muted = row.inactive || row.lowConfidence;
              return (
                <tr key={row.userId}>
                  <td className="max-w-[16rem] py-2.5 pr-3">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-medium text-foreground">{row.name}</span>
                      {row.needsSupport && (
                        <span className="shrink-0 rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] text-destructive">
                          Needs support
                        </span>
                      )}
                      {row.inactive && (
                        <span className="shrink-0 rounded-full bg-black/[0.05] px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] text-foreground/50">
                          No sends
                        </span>
                      )}
                      {row.lowConfidence && (
                        <span
                          title={`Under ${MIN_SAMPLE_EMAILS} emails sent — the rates are indicative only.`}
                          className="shrink-0 rounded-full bg-black/[0.05] px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] text-foreground/50"
                        >
                          Low sample
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="py-2.5 text-right text-foreground/70">
                    {row.emailsSent.toLocaleString()}
                  </td>
                  <td className="py-2.5 text-right text-foreground/70">
                    {row.replies.toLocaleString()}
                  </td>
                  <td
                    className={`py-2.5 text-right ${
                      row.needsSupport
                        ? "font-bold text-destructive"
                        : muted
                          ? "text-foreground/35"
                          : "text-foreground/70"
                    }`}
                  >
                    {pct(row.replyRate)}
                  </td>
                  <td className="py-2.5 text-right text-foreground/70">
                    {row.conversions.toLocaleString()}
                  </td>
                  <td
                    className={`py-2.5 text-right font-semibold ${
                      muted ? "text-foreground/35" : "text-foreground"
                    }`}
                  >
                    {pct(row.conversionRate)}
                  </td>
                </tr>
              );
            })}
          </tbody>
          {board.teamReplyRate !== null && (
            <tfoot>
              <tr className="border-t border-black/[0.06] text-[12px] text-foreground/45">
                <td className="pt-2.5 font-bold uppercase tracking-[0.08em]">Team</td>
                <td className="pt-2.5 text-right" />
                <td className="pt-2.5 text-right" />
                <td className="pt-2.5 text-right font-bold">{pct(board.teamReplyRate)}</td>
                <td className="pt-2.5 text-right" />
                <td className="pt-2.5 text-right" />
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <p className="mt-3 text-[11px] leading-[1.6] text-foreground/35">
        &ldquo;Needs support&rdquo; means a reply rate under 60% of the team median, on at
        least {MIN_SAMPLE_EMAILS} sent emails — a coaching signal, not a verdict.
      </p>
    </div>
  );
}

export default CamLeaderboardTable;
