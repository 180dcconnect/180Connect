import { labelForStatus, styleForStatus } from "./status-helpers.ts";

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-block rounded-full px-3 py-1 text-xs font-bold ${styleForStatus(status)}`}
    >
      {labelForStatus(status)}
    </span>
  );
}