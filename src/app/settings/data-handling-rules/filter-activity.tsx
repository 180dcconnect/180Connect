import { ChevronRight } from "lucide-react";
import { excludedFieldLabel } from "@/lib/data-handling-catalogue";
import type { FilterActivity } from "./actions";
import { CARD, CARD_HINT, CARD_TITLE, FOOTNOTE, ROW } from "../styles";

/**
 * What the rules have actually removed from stored records (F246).
 *
 * The protections list states intent; this states effect — a field silently
 * dropped during an overnight import is exactly the case where nobody is
 * watching. Names come from the same catalogue as the list above, so the two
 * cards describe the same thing in the same words.
 */

function formatCount(value: number): string {
  return value.toLocaleString("en-GB");
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-inset bg-paper px-4 py-3">
      <dt className="text-[13px] text-dim">{label}</dt>
      <dd className="mt-1 font-body text-[28px] leading-none font-light tabular-nums text-ink">
        {formatCount(value)}
      </dd>
    </div>
  );
}

export function FilterActivityPanel({ activity }: { activity: FilterActivity }) {
  const { recordsTotal, recordsChecked, recordsStripped, fields, error } = activity;

  // Rows written before the rules existed, or before the last rule change. Only a
  // developer can close this (the backfill script), so the page says so plainly
  // and keeps the command itself inside a developer note.
  const unchecked = Math.max(recordsTotal - recordsChecked, 0);

  return (
    <section aria-labelledby="activity-heading" className={CARD}>
      <h2 id="activity-heading" className={CARD_TITLE}>
        What has been removed so far
      </h2>
      <p className={CARD_HINT}>
        Across every imported record the platform holds, not just the latest import.
      </p>

      {error ? (
        <p className={`mt-4 ${FOOTNOTE}`}>{error}</p>
      ) : (
        <>
          <dl className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Stat label="Imported records" value={recordsTotal} />
            <Stat label="Checked for personal details" value={recordsChecked} />
            <Stat label="Had personal details removed" value={recordsStripped} />
          </dl>

          {unchecked > 0 && (
            <div className="mt-4 rounded-inset bg-hold-wash px-4 py-3" role="status">
              <p className="text-[13px] leading-[1.55] text-ink">
                <span className="font-semibold">{formatCount(unchecked)}</span> older{" "}
                {unchecked === 1 ? "record was" : "records were"} saved before the current
                protections, so {unchecked === 1 ? "it has" : "they have"} not been checked yet.
                New imports are always checked. To check the older ones, ask a developer to run
                the data handling clean-up.
              </p>
              <details className="group mt-2">
                <summary className="flex cursor-pointer list-none items-center gap-1 text-[12.5px] font-medium text-dim hover:text-ink">
                  <ChevronRight
                    aria-hidden="true"
                    className="size-3 transition-transform group-open:rotate-90"
                  />
                  For developers
                </summary>
                <p className="mt-1.5 text-[12.5px] leading-[1.55] text-dim">
                  Run <code className="font-mono">npm run backfill:data-handling-rules -- --dry-run</code>,
                  check the counts, then run it again without <code className="font-mono">--dry-run</code>.
                </p>
              </details>
            </div>
          )}

          {fields.length === 0 ? (
            <p className={`mt-4 ${FOOTNOTE}`}>
              Nothing has been removed yet. That is normal if the sources imported so far
              have not included any of these personal details.
            </p>
          ) : (
            <ul className="mt-4">
              {fields.map((field) => {
                const label = excludedFieldLabel(field.field_path);
                return (
                  <li key={field.field_path} className={`${ROW} items-start`}>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-ink">{label ?? "Other personal detail"}</p>
                      {label === null && (
                        <p className="mt-0.5 font-mono text-[11.5px] text-faint">
                          {field.field_path}
                        </p>
                      )}
                    </div>
                    <p className="text-right text-[13px] text-dim">
                      <span className="font-semibold text-ink tabular-nums">
                        {formatCount(field.records_affected)}
                      </span>{" "}
                      {field.records_affected === 1 ? "record" : "records"}
                      <span className="block text-[12.5px]">
                        Last on {formatDate(field.last_applied)}
                      </span>
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
