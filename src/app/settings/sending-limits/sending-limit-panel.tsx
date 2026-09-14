"use client";

import { useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { HorizontalStickGauge } from "@/components/ui/horizontal-stick-gauge";
import { setOutreachDailySendLimit } from "./actions";
import {
  CARD,
  CARD_HINT,
  CARD_TITLE,
  FIELD_LABEL,
  FOOTNOTE,
  INPUT,
  PRIMARY_BUTTON,
} from "@/app/settings/styles";

export function SendingLimitPanel({
  currentLimit,
  sentToday,
  updatedAt,
}: {
  currentLimit: number;
  sentToday: number;
  updatedAt: string | null;
}) {
  const [limit, setLimit] = useState(currentLimit);
  const [input, setInput] = useState(String(currentLimit));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageTone, setMessageTone] = useState<"ok" | "error">("ok");

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const parsed = Number(input);
    if (!Number.isInteger(parsed) || parsed < 1) {
      setMessageTone("error");
      setMessage("Enter a whole number of at least 1.");
      return;
    }
    setBusy(true);
    setMessage(null);
    const result = await setOutreachDailySendLimit({ limit: parsed });
    if (result.ok) {
      setLimit(parsed);
      setMessageTone("ok");
    } else {
      setMessageTone("error");
    }
    setMessage(result.message);
    setBusy(false);
  }

  const percentUsed = limit > 0 ? Math.min(100, Math.round((sentToday / limit) * 100)) : 0;
  const nearLimit = sentToday >= Math.ceil(limit * 0.8);

  return (
    <section aria-labelledby="sending-limit-heading" className={CARD}>
      <h2 id="sending-limit-heading" className={CARD_TITLE}>
        Daily sending cap
      </h2>
      <p className={CARD_HINT}>
        A branch-wide limit on how many outreach emails the shared mailbox sends
        per UK calendar day (resets at midnight UK time), across every CAM
        combined. A CAM attempting to send once the cap is reached sees a clear
        message and nothing goes out. Changes take effect on the next send attempt.
      </p>

      {/* Usage gauge */}
      <div className="mt-5 border-t border-rule-soft pt-4">
        <p className={FIELD_LABEL}>Sent today</p>
        <p
          className="mt-1.5 text-sm text-ink"
          role={nearLimit ? "alert" : "status"}
        >
          {sentToday} of {limit} ({percentUsed}%)
          {nearLimit && (
            <span className="ml-2 font-medium text-hold">
              · Close to the daily cap
            </span>
          )}
        </p>
        <div className="mt-3">
          <HorizontalStickGauge
            checked={sentToday}
            total={limit}
            ariaLabel={`${sentToday} of ${limit} outreach emails sent today`}
            activeColor={nearLimit ? "var(--hold)" : "var(--go)"}
            checkedLabel="Sent today"
            remainingLabel="Remaining"
            valueFormatter={(v) => v.toLocaleString()}
          />
        </div>
      </div>

      {/* Edit form */}
      <form onSubmit={save} noValidate className="mt-5 border-t border-rule-soft pt-4">
        <label htmlFor="daily_limit" className={FIELD_LABEL}>
          Daily sending limit
        </label>
        <input
          id="daily_limit"
          className={`mt-2 w-36 ${INPUT}`}
          inputMode="numeric"
          min={1}
          onChange={(event) => setInput(event.target.value)}
          type="number"
          value={input}
          aria-describedby="daily_limit_hint"
        />
        <p id="daily_limit_hint" className="mt-2 text-[13px] leading-[1.55] text-dim">
          {updatedAt
            ? `Last changed ${new Date(updatedAt).toLocaleString("en-GB")}.`
            : "Never changed from the default."}
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
          <button
            type="submit"
            disabled={busy}
            aria-busy={busy || undefined}
            className={PRIMARY_BUTTON}
          >
            {busy && <Loader2 className="size-3.5 animate-spin" strokeWidth={2.2} />}
            {busy ? "Saving…" : "Save limit"}
          </button>
          {message && messageTone === "ok" && (
            <p
              aria-live="polite"
              className="flex items-center gap-1.5 text-[13px] font-semibold text-go"
            >
              <Check aria-hidden="true" className="size-3.5 shrink-0" strokeWidth={2.5} />
              {message}
            </p>
          )}
          {message && messageTone === "error" && (
            <p
              aria-live="polite"
              role="alert"
              className="text-[13px] font-semibold text-stop"
            >
              {message}
            </p>
          )}
        </div>
      </form>

      <div className="mt-4 border-t border-rule-soft pt-4">
        <p className={FOOTNOTE}>
          This cap is set by an administrator and applies to the whole branch.
          Only admins can change it.
        </p>
      </div>
    </section>
  );
}
