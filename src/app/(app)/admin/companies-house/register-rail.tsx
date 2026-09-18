"use client";

import { useEffect, useState, useTransition } from "react";
import { CheckCircle2, Loader2, RefreshCw, TriangleAlert } from "lucide-react";

import { OriginButton } from "@/components/ui/origin-button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/animate-ui/components/radix/dialog";
import {
  refreshCompaniesRegister,
  companiesRefreshStatus,
  type CompaniesRefreshState,
} from "./refresh-actions";

const STALE_AFTER_DAYS = 45;

/**
 * How current the companies register is, and the one control that changes that.
 *
 * The twin of the charity register's rail: two facts and one button — how many
 * companies are staged, when the snapshot was taken, and refresh. The stale
 * threshold is wider than the charity screen's (45 vs 35 days) because the
 * source rebuilds monthly and the file only ever claims "as of last month":
 * a copy a few weeks old is normal, and the warning means a monthly rebuild
 * was missed rather than "this is ageing".
 */
export function CompaniesRegisterRail({
  snapshotDate,
  sourceMonth,
  registerSize,
  staleDays,
  canRefresh,
}: {
  snapshotDate: string | null;
  /** The snapshot month the file was built from (YYYY-MM), when known. */
  sourceMonth: string | null;
  registerSize: number;
  /** Whether this deployment can trigger a rebuild (GITHUB_REGISTER_TOKEN set). */
  canRefresh: boolean;
  /**
   * How old the snapshot is, in days. Computed by the page rather than here:
   * reading the clock during render is impure, and the page is the async server
   * component that already owns one clock for the whole screen.
   */
  staleDays: number | null;
}) {
  const [state, setState] = useState<CompaniesRefreshState>({ kind: "idle" });
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const running = state.kind === "running" || state.kind === "started";
  const stale = staleDays !== null && staleDays > STALE_AFTER_DAYS;

  useEffect(() => {
    if (!canRefresh || !running) return;
    const timer = setInterval(async () => {
      setState(await companiesRefreshStatus());
    }, 15_000);
    return () => clearInterval(timer);
  }, [canRefresh, running]);

  // One status read on mount, so a refresh started from another browser — or by
  // the schedule — is visible here rather than looking like nothing happened.
  useEffect(() => {
    if (!canRefresh) return;
    let cancelled = false;
    companiesRefreshStatus().then((next) => {
      if (!cancelled && next.kind === "running") setState(next);
    });
    return () => {
      cancelled = true;
    };
  }, [canRefresh]);

  const start = () =>
    startTransition(async () => {
      setState(await refreshCompaniesRegister());
      setOpen(false);
    });

  return (
    <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2">
      <p className="flex items-center gap-2 text-sm text-foreground/55">
        <span
          aria-hidden
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${
            snapshotDate === null
              ? "bg-foreground/25"
              : stale
                ? "bg-amber-500"
                : "bg-emerald-500"
          }`}
        />
        {snapshotDate === null ? (
          <span>The register has not been loaded yet — refresh to build it.</span>
        ) : (
          <span>
            <span className="font-semibold tabular-nums text-foreground/85">
              {registerSize.toLocaleString()}
            </span>{" "}
            companies in the register
            {sourceMonth ? (
              <>
                {" "}· snapshot{" "}
                <span className="text-foreground/85">{sourceMonth}</span>
              </>
            ) : (
              <>
                {" "}· checked{" "}
                <span className="text-foreground/85">
                  {new Date(snapshotDate).toLocaleDateString("en-GB", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })}
                </span>
              </>
            )}
            {stale && (
              <span className="text-amber-700"> · may be out of date</span>
            )}
          </span>
        )}
      </p>

      {canRefresh && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          disabled={running || isPending}
          className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-bold text-foreground/55 transition-colors hover:bg-black/[0.04] hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
        >
          <RefreshCw className="h-3.5 w-3.5" strokeWidth={2.2} />
          Refresh
        </button>
      )}

      {/* Progress lives on the rail, not in the dialog: the dialog closes the
          moment the run starts, and this is a twenty-minute job someone is
          expected to walk away from. */}
      {running && (
        <p className="flex items-center gap-1.5 text-xs text-foreground/60" role="status">
          <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.2} />
          Refreshing
          {state.kind === "running" && state.startedAt
            ? ` — started ${new Date(state.startedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`
            : ""}
          . You can leave this page.
        </p>
      )}

      {state.kind === "finished" && (
        <p
          className={`flex items-center gap-1.5 text-xs ${
            state.success ? "text-emerald-800" : "text-amber-800"
          }`}
          role="status"
        >
          {state.success ? (
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" strokeWidth={2.2} />
          ) : (
            <TriangleAlert className="h-3.5 w-3.5 shrink-0" strokeWidth={2.2} />
          )}
          {state.message}
        </p>
      )}

      {state.kind === "error" && (
        <p className="text-xs font-bold text-red-800" role="alert">
          {state.message}
        </p>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="rounded-2xl sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Refresh the register?</DialogTitle>
            <DialogDescription className="leading-[1.65]">
              Fetches the latest published snapshot from Companies House. It usually
              takes a few minutes — you can close this page and carry on working
              while it runs.
              {stale && (
                <>
                  {" "}
                  This copy is {staleDays} days old — older than the monthly
                  rebuild should ever leave it, so one was probably missed. It
                  may not list companies incorporated since, and may still list
                  companies that have closed.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <button
                type="button"
                className="rounded-lg px-3 py-2 text-sm font-bold text-foreground/60 transition-colors hover:bg-black/[0.04] hover:text-foreground"
              >
                Cancel
              </button>
            </DialogClose>
            <OriginButton onClick={start} disabled={isPending} size="md" type="button">
              <span className="inline-flex items-center gap-1.5">
                {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.2} />}
                Refresh
              </span>
            </OriginButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
