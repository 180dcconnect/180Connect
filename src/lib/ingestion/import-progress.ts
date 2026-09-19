/**
 * Progress metadata shared by register-import writers and the Import Status UI.
 *
 * Register imports know their selection size before they start, but do not
 * expose a trustworthy per-record completion count while promotion is running.
 * Recording one small estimate on the existing run row lets the UI show useful
 * movement without adding polling queries or a database write for every batch.
 */

export const REGISTER_IMPORT_SECONDS_PER_ITEM = 0.5;

export type ImportProgressPlan =
  | { kind: "measured"; completed: number; total: number }
  | { kind: "estimated"; total: number; durationSeconds: number };

export type ImportProgressReading = {
  percent: number;
  statusText: string;
  ariaValueText: string;
};

function asCount(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function asPositiveNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

/** Metadata written once when a register import opens its run row. */
export function registerImportProgressStats(total: number): {
  estimated_total_items: number;
  estimated_duration_seconds: number;
} {
  const safeTotal = Math.max(0, Math.floor(total));
  return {
    estimated_total_items: safeTotal,
    estimated_duration_seconds: estimateRegisterImportSeconds(safeTotal),
  };
}

export function estimateRegisterImportSeconds(total: number): number {
  return Math.max(1, Math.ceil(Math.max(0, total) * REGISTER_IMPORT_SECONDS_PER_ITEM));
}

/** Reads either a real source heartbeat or the register import's stated estimate. */
export function importProgressPlanFromStats(stats: unknown): ImportProgressPlan | null {
  if (typeof stats !== "object" || stats === null) return null;
  const record = stats as Record<string, unknown>;

  const walked = asCount(record.walked_organisations);
  const measuredTotal = asCount(record.total_organisations);
  if (walked !== null && measuredTotal !== null && measuredTotal > 0) {
    return {
      kind: "measured",
      completed: Math.min(walked, measuredTotal),
      total: measuredTotal,
    };
  }

  const estimatedTotal = asCount(record.estimated_total_items);
  const durationSeconds = asPositiveNumber(record.estimated_duration_seconds);
  if (estimatedTotal !== null && estimatedTotal > 0 && durationSeconds !== null) {
    return { kind: "estimated", total: estimatedTotal, durationSeconds };
  }

  return null;
}

export function formatProgressDuration(totalSeconds: number): string {
  const seconds = Number.isFinite(totalSeconds) ? Math.max(0, Math.round(totalSeconds)) : 0;
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const remainder = seconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
    : `${minutes}:${String(remainder).padStart(2, "0")}`;
}

/**
 * Turns a plan into the reading shown now. Estimated progress never reaches
 * 100% while the run is open: only the database's completed state can do that.
 */
export function importProgressReadingAt(
  plan: ImportProgressPlan,
  startedAt: string,
  nowMs: number,
): ImportProgressReading {
  const startedMs = Date.parse(startedAt);
  const elapsedSeconds = Number.isFinite(startedMs)
    ? Math.max(0, Math.floor((nowMs - startedMs) / 1_000))
    : 0;
  const elapsedLabel = formatProgressDuration(elapsedSeconds);

  if (plan.kind === "measured") {
    const rawPercent = Math.round((plan.completed / plan.total) * 100);
    const percent = Math.min(95, rawPercent);
    const count = `${plan.completed.toLocaleString()} of ${plan.total.toLocaleString()} source checks finished`;

    if (plan.completed >= plan.total) {
      const statusText = `${count} · saving the results.`;
      return { percent, statusText, ariaValueText: statusText };
    }

    const estimatedLeft =
      plan.completed > 0 && elapsedSeconds > 0
        ? Math.ceil((elapsedSeconds / plan.completed) * (plan.total - plan.completed))
        : null;
    const statusText = estimatedLeft
      ? `${count} · ${elapsedLabel} so far · about ${formatProgressDuration(estimatedLeft)} to go.`
      : `${count} · ${elapsedLabel} so far · estimating time remaining.`;
    return { percent, statusText, ariaValueText: statusText };
  }

  const estimatedLeft = Math.max(0, plan.durationSeconds - elapsedSeconds);
  const percent = Math.min(95, Math.round((elapsedSeconds / plan.durationSeconds) * 100));
  const planned = `${plan.total.toLocaleString()} ${plan.total === 1 ? "record" : "records"} planned`;
  const statusText =
    estimatedLeft > 0
      ? `${planned} · ${elapsedLabel} so far · about ${formatProgressDuration(estimatedLeft)} to go (estimated).`
      : `${planned} · ${elapsedLabel} so far · taking longer than estimated, still working.`;
  return { percent, statusText, ariaValueText: statusText };
}
