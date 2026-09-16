import {
  INCOME_BAND_DESCRIPTIONS,
  INCOME_BAND_LABELS,
  INCOME_BAND_OPTIONS,
  INCOME_BAND_SHORT_NAMES,
  type IncomeBand,
} from "@/lib/income-band";

interface IncomeBandScaleProps {
  activeBand: IncomeBand | null;
  totalIncome?: number | null;
  periodEnd?: string | null;
  showSummary?: boolean;
  compact?: boolean;
}

export function IncomeBandScale({
  activeBand,
  totalIncome,
  periodEnd,
  showSummary = true,
  compact = false,
}: IncomeBandScaleProps) {
  const year = periodEnd ? new Date(periodEnd).getFullYear() : null;
  const fyLabel = year ? `FY${String(year).slice(-2)}` : null;

  return (
    <div className="w-full space-y-2.5">
      {/* 4-Stage Segmented Bar */}
      <div
        aria-label="Income band tiers"
        className={`grid grid-cols-2 gap-1.5 sm:grid-cols-4 ${
          compact ? "text-[11px]" : "text-[12px]"
        }`}
        role="group"
      >
        {INCOME_BAND_OPTIONS.map((band) => {
          const isActive = band === activeBand;
          const label = INCOME_BAND_LABELS[band];
          const shortName = INCOME_BAND_SHORT_NAMES[band];

          return (
            <div
              key={band}
              aria-current={isActive ? "true" : undefined}
              className={`relative flex flex-col items-center justify-center rounded-inset px-2.5 py-2 transition-all ${
                isActive
                  ? "border border-lead/20 bg-lead text-white shadow-xs font-semibold"
                  : "border border-rule-soft bg-paper/60 text-dim"
              }`}
              title={INCOME_BAND_DESCRIPTIONS[band]}
            >
              <div className="flex items-center gap-1">
                {isActive && (
                  <span
                    aria-hidden="true"
                    className="size-1.5 shrink-0 rounded-full bg-white"
                  />
                )}
                <span className={isActive ? "text-white" : "text-ink font-medium"}>
                  {shortName}
                </span>
              </div>
              <span
                className={`font-mono text-[10.5px] tabular-nums ${
                  isActive ? "text-white/80" : "text-faint"
                }`}
              >
                {label}
              </span>
            </div>
          );
        })}
      </div>

      {/* Summary caption */}
      {showSummary && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-[12.5px] text-dim">
          {activeBand ? (
            <p className="flex items-center gap-1.5">
              <span>Tier:</span>
              <strong className="font-semibold text-ink">
                {INCOME_BAND_DESCRIPTIONS[activeBand]}
              </strong>
            </p>
          ) : (
            <p className="text-faint">No income band on record.</p>
          )}

          {totalIncome !== null && totalIncome !== undefined && (
            <p className="font-mono text-[12px] tabular-nums text-ink">
              Latest:{" "}
              <strong className="font-semibold">
                £{totalIncome.toLocaleString("en-GB")}
              </strong>
              {fyLabel ? ` (${fyLabel})` : ""}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
