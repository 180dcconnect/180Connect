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
import { refreshRegister, refreshStatus, type RefreshState } from "./refresh-actions";

const STALE_AFTER_DAYS = 35;

/**
 * How current the register is, and the one control that changes that.
 *
 * This replaces a card. The card explained that the register is a file shipped
 * with the deployment, that filtering is a query over it, and that this costs
 * the database nothing — all true, and none of it anything a CAM can act on.
 * What they can act on is two facts and one button: how many charities are in
 * there, when it was last checked, and refresh. So it is a line of text under
 * the tabs, not a section competing with the import for attention.
 *
 * The old card also said "taken 3 Sep · 1 day old", which is the same fact
 * twice. The date is the fact; age only earns space once it is a problem, at
 * which point it arrives as an amber dot and a warning rather than a number.
 *
 * ── Why refresh is a dialog ──
 *
 * The explanation ("about twelve minutes") only matters at the moment you are
 * deciding whether to start one, so it lives at that moment instead of sitting
 * on the page permanently. The rail then becomes the progress readout: a
 * refresh in flight is a property of the register, which is what this line is
 * about.
 */
export function RegisterRail({
  snapshotDate,
  registerSize,
  staleDays,
  canRefresh,
}: {
  snapshotDate: string | null;
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
  const [state, setState] = useState<RefreshState>({ kind: "idle" });
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const running = state.kind === "running" || state.kind === "started";

  // The regulator republishes daily, so a copy is *technically* behind within a
  // day. The question this warning answers is not "is it behind" but "is it
  // behind by more than intended", and the intent is the monthly rebuild in
  // .github/workflows/refresh-charity-register.yml (03:00 UTC on the 1st).
  //
  // So the threshold is a month plus slack: 35 days covers a 31-day gap, the
  // build itself, and the redeploy that carries the file. Anything older means
  // a rebuild was missed or a deployment did not pick it up, which is worth
  // saying. A warning that is always on is one nobody reads.
  const stale = staleDays !== null && staleDays > STALE_AFTER_DAYS;

  useEffect(() => {
    if (!canRefresh || !running) return;
    const timer = setInterval(async () => {
      setState(await refreshStatus());
    }, 15_000);
    return () => clearInterval(timer);
  }, [canRefresh, running]);

  // One status read on mount, so a refresh started from another browser — or by
  // the schedule — is visible here rather than looking like nothing happened.
  useEffect(() => {
    if (!canRefresh) return;
    let cancelled = false;
    refreshStatus().then((next) => {
      if (!cancelled && next.kind === "running") setState(next);
    });
    return () => {
      cancelled = true;
    };
  }, [canRefresh]);

  const start = () =>
    startTransition(async () => {
      setState(await refreshRegister());
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
            charities in the register · checked{" "}
            <span className="text-foreground/85">
              {new Date(snapshotDate).toLocaleDateString("en-GB", {
                day: "numeric",
                month: "short",
                year: "numeric",
              })}
            </span>
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
          moment the run starts, and this is a twelve-minute job someone is
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
              Fetches the latest data from the Charity Commission. It takes about
              twelve minutes — you can close this page and carry on working while
              it runs.
              {stale && (
                <>
                  {" "}
                  This copy is {staleDays} days old — older than the monthly
                  rebuild should ever leave it, so one was probably missed. It
                  may not list charities registered since, and may still list
                  charities that have closed.
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
