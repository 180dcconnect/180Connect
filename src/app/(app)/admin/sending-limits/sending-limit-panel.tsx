"use client";

import { useState } from "react";
import { OriginButton } from "@/components/ui/origin-button";
import { setOutreachDailySendLimit } from "./actions";

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
  const [messageTone, setMessageTone] = useState<"info" | "error">("info");

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
      setMessageTone("info");
    } else {
      setMessageTone("error");
    }
    setMessage(result.message);
    setBusy(false);
  }

  const percentUsed = limit > 0 ? Math.min(100, Math.round((sentToday / limit) * 100)) : 0;
  const nearLimit = sentToday >= Math.ceil(limit * 0.8);

  return (
    <div className="mt-6">
      <p
        className={`rounded-lg p-3 text-sm font-bold ${nearLimit ? "bg-amber-50 text-amber-900" : "bg-black/[0.03] text-foreground/60"}`}
        role={nearLimit ? "alert" : "status"}
      >
        {sentToday} of {limit} emails sent today ({percentUsed}%).
        {nearLimit ? " Close to the daily cap." : ""}
      </p>

      <form onSubmit={save} className="mt-5 rounded-xl border border-black/10 bg-black/[0.015] p-4">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/40">
            Daily sending limit
          </span>
          <input
            className="mt-1 w-full max-w-[10rem] rounded-lg border border-black/10 bg-white px-3 py-2 text-sm"
            inputMode="numeric"
            min={1}
            onChange={(event) => setInput(event.target.value)}
            type="number"
            value={input}
          />
        </label>
        <p className="mt-2 text-[13px] leading-[1.6] text-foreground/50">
          {updatedAt
            ? `Last changed ${new Date(updatedAt).toLocaleString("en-GB")}.`
            : "Never changed from the default."}
        </p>
        <OriginButton className="mt-3" disabled={busy} loading={busy} size="sm" type="submit">
          Save limit
        </OriginButton>
      </form>

      {message && (
        <p
          aria-live="polite"
          className={`mt-3 text-[13px] font-bold ${messageTone === "error" ? "text-red-800" : "text-emerald-700"}`}
          role={messageTone === "error" ? "alert" : undefined}
        >
          {message}
        </p>
      )}
    </div>
  );
}
