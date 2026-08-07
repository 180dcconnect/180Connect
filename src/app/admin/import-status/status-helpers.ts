// Pure status-label/style logic, split out from status-badge.tsx so it can
// be tested with node:test directly — Node can strip plain .ts type
// annotations, but not .tsx JSX syntax, without a real build step.

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

export function styleForStatus(status: string): string {
  return STYLES[status] ?? "bg-gray-50 text-gray-800";
}

export function labelForStatus(status: string): string {
  return LABELS[status] ?? status;
}