// Status pill for an ingestion_runs.job_status value. No client interactivity
// needed, so this stays a plain function component rather than "use client".

const STYLES: Record<string, string> = {
  completed: "bg-green-50 text-green-800",
  partial: "bg-amber-50 text-amber-800",
  failed: "bg-red-50 text-red-800",
  running: "bg-blue-50 text-blue-800",
};

const LABELS: Record<string, string> = {
  completed: "Succeeded",
  partial: "Partially succeeded",
  failed: "Failed",
  running: "Running",
};

export function StatusBadge({ status }: { status: string }) {
  const style = STYLES[status] ?? "bg-gray-50 text-gray-800";
  const label = LABELS[status] ?? status;

  return (
    <span
      className={`inline-block rounded-full px-3 py-1 text-xs font-bold ${style}`}
    >
      {label}
    </span>
  );
}