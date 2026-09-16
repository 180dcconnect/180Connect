"use client";

import Link from "next/link";
import { HorizontalStickGauge } from "@/components/ui/horizontal-stick-gauge";

/**
 * Sending capacity — how much of today's branch-wide outreach limit is used.
 *
 * The limit is one mailbox-wide cap shared by every CAM (F128), enforced when
 * an email is claimed for sending. Until now the only place to see how close
 * the branch was to it was the admin settings page, so a CAM found out the
 * limit was reached by pressing Send. The day is the UK calendar day, the same
 * boundary the database enforces (`dailySendWindowStart`).
 *
 * A client component only because the gauge takes a formatter function.
 */
export type SendingCapacity = {
  limit: number;
  sentToday: number;
  /** Scheduled emails still due to go out before UK midnight. */
  scheduledToday: number;
};

export function SendingCapacityCard({
  capacity,
  canChangeLimit,
}: {
  capacity: SendingCapacity;
  canChangeLimit: boolean;
}) {
  const { limit, sentToday, scheduledToday } = capacity;
  const remaining = Math.max(limit - sentToday, 0);
  const used = limit > 0 ? sentToday / limit : 1;
  const tone = remaining === 0 ? "var(--stop)" : used >= 0.8 ? "var(--hold)" : "var(--go)";

  return (
    <section
      aria-labelledby="sending-capacity-heading"
      className="flex h-full flex-col rounded-panel border border-rule bg-white px-5 py-4"
    >
      <h2
        id="sending-capacity-heading"
        className="font-body text-[18px] leading-[1.3] font-semibold tracking-[-0.01em] text-ink"
      >
        Sending capacity today
      </h2>
      <p className="mt-1 font-body text-[13px] leading-[1.55] text-dim">
        The whole branch shares one daily limit. It resets at midnight UK time.
      </p>

      <p className="mt-5 flex flex-wrap items-baseline gap-x-2">
        <span className="font-body text-[clamp(1.75rem,4vw,2.5rem)] leading-none font-semibold tracking-[-0.03em] tabular-nums text-ink">
          {remaining.toLocaleString()}
        </span>
        <span className="font-body text-[13px] leading-[1.55] text-dim">
          {remaining === 1 ? "email" : "emails"} left to send today
        </span>
      </p>

      <div className="mt-4">
        <HorizontalStickGauge
          checked={Math.min(sentToday, limit)}
          total={Math.max(limit, 1)}
          activeColor={tone}
          checkedLabel="Sent today"
          remainingLabel="Still available"
          ariaLabel={`${sentToday} of ${limit} outreach emails sent today`}
          valueFormatter={(value) => value.toLocaleString()}
        />
      </div>

      <p className="mt-2 font-body text-[12.5px] leading-[1.55] text-dim">
        {sentToday.toLocaleString()} of {limit.toLocaleString()} sent
        {scheduledToday > 0
          ? ` · ${scheduledToday.toLocaleString()} more scheduled before midnight`
          : ""}
      </p>

      {remaining === 0 && (
        <p className="mt-2 font-body text-[12.5px] leading-[1.55] font-semibold text-stop">
          The limit is reached. Emails can be sent again after midnight
          {canChangeLimit ? ", or raise the limit now." : "."}
        </p>
      )}

      {canChangeLimit && (
        <Link
          href="/admin/sending-limits"
          className="mt-auto pt-3 font-body text-[13px] font-semibold text-lead transition-colors hover:text-lead-mid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lead"
        >
          Change the daily limit →
        </Link>
      )}
    </section>
  );
}

export default SendingCapacityCard;
