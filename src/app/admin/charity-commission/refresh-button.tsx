"use client";

import { useEffect, useState, useTransition } from "react";
import { CheckCircle2, Loader2, RefreshCw, TriangleAlert } from "lucide-react";

import { OriginButton } from "@/components/ui/origin-button";
import { refreshRegister, refreshStatus, type RefreshState } from "./refresh-actions";

/**
 * Rebuilds the register without anyone opening a terminal.
 *
 * The work happens in a GitHub Action — twelve minutes of downloading and
 * parsing that no serverless function would hold — so this button starts it and
 * then reports on it. While a run is in flight it polls every fifteen seconds,
 * which is frequent enough to feel live and rare enough to stay well inside
 * GitHub's rate limit for a screen someone might leave open.
 */
export function RefreshButton({ configured }: { configured: boolean }) {
  const [state, setState] = useState<RefreshState>({ kind: "idle" });
  const [isPending, startTransition] = useTransition();

  const running = state.kind === "running" || state.kind === "started";

  useEffect(() => {
    if (!configured || !running) return;
    const timer = setInterval(async () => {
      const next = await refreshStatus();
      setState(next);
    }, 15_000);
    return () => clearInterval(timer);
  }, [configured, running]);

  // One status read on mount, so a refresh started from another browser — or by
  // the schedule — is visible here rather than looking like nothing happened.
  useEffect(() => {
    if (!configured) return;
    let cancelled = false;
    refreshStatus().then((next) => {
      if (!cancelled && next.kind === "running") setState(next);
    });
    return () => {
      cancelled = true;
    };
  }, [configured]);

  if (!configured) return null;

  const start = () =>
    startTransition(async () => {
      setState(await refreshRegister());
    });

  return (
    <div className="mt-5 rounded-xl border border-black/[0.07] bg-black/[0.015] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-[0.1em] text-foreground/45">
            Refresh the register
          </p>
          <p className="mt-1 text-xs leading-[1.5] text-foreground/55">
            Fetches the latest data from the Charity Commission. Takes about
            twelve minutes and happens automatically once a month.
          </p>
        </div>

        <OriginButton onClick={start} disabled={isPending || running} size="md" type="button">
          <span className="inline-flex items-center gap-1.5">
            {running ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.2} />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" strokeWidth={2.2} />
            )}
            {running ? "Refreshing…" : "Refresh register"}
          </span>
        </OriginButton>
      </div>

      {state.kind === "started" && (
        <p className="mt-3 text-xs leading-[1.6] text-foreground/70" role="status">
          {state.message}
        </p>
      )}

      {state.kind === "running" && (
        <p className="mt-3 flex items-center gap-2 text-xs text-foreground/70" role="status">
          <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.2} />
          Rebuilding
          {state.startedAt
            ? ` — started ${new Date(state.startedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`
            : ""}
          . You can leave this page.
        </p>
      )}

      {state.kind === "finished" && (
        <p
          className={`mt-3 flex items-start gap-2 text-xs leading-[1.6] ${
            state.success ? "text-green-900" : "text-amber-900"
          }`}
          role="status"
        >
          {state.success ? (
            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2.2} />
          ) : (
            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2.2} />
          )}
          {state.message}
        </p>
      )}

      {state.kind === "error" && (
        <p className="mt-3 text-xs font-bold text-red-900" role="alert">
          {state.message}
        </p>
      )}
    </div>
  );
}
