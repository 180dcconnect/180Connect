import type { FilterActivity } from "./actions";

/**
 * What the rules have actually stripped from stored records (F246).
 *
 * The rules table above this states intent. This states effect — the AC asks for
 * clear feedback when something is blocked, and a field silently dropped during
 * an overnight import is exactly the case where nobody is watching.
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

export function FilterActivityPanel({ activity }: { activity: FilterActivity }) {
  const { recordsTotal, recordsChecked, recordsStripped, fields, error } =
    activity;

  // Rows written before the rules existed, or before the last rule change. The
  // backfill script is what closes this, so name it rather than just showing a
  // number nobody can act on.
  const unchecked = Math.max(recordsTotal - recordsChecked, 0);

  return (
    <section className="mt-8 rounded-xl border border-black/10 p-5">
      <h2 className="font-bold">What the rules have excluded</h2>
      <p className="mt-1 text-sm text-foreground/65">
        Counted across every record currently stored, not just the last import.
      </p>

      {error ? (
        <p className="mt-4 text-sm text-foreground/65">{error}</p>
      ) : (
        <>
          <dl className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <dt className="text-sm text-foreground/65">Records stored</dt>
              <dd className="text-2xl font-bold">{formatCount(recordsTotal)}</dd>
            </div>
            <div>
              <dt className="text-sm text-foreground/65">Checked against rules</dt>
              <dd className="text-2xl font-bold">
                {formatCount(recordsChecked)}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-foreground/65">Had fields stripped</dt>
              <dd className="text-2xl font-bold">
                {formatCount(recordsStripped)}
              </dd>
            </div>
          </dl>

          {unchecked > 0 && (
            <p
              className="mt-5 rounded-xl bg-amber-50 p-4 text-sm text-amber-900"
              role="status"
            >
              <strong>{formatCount(unchecked)}</strong> stored{" "}
              {unchecked === 1 ? "record has" : "records have"} not been checked
              against the current rules. These were written before the rules
              existed or before the last rule change. Run{" "}
              <code className="font-mono text-xs">
                npm run backfill:data-handling-rules
              </code>{" "}
              to apply the rules to them.
            </p>
          )}

          {fields.length === 0 ? (
            <p className="mt-5 text-sm text-foreground/65">
              No fields have been stripped from stored records yet. A rule that
              never matches may have a field path that does not match the
              source&rsquo;s own naming.
            </p>
          ) : (
            <div className="mt-5 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-black/10 text-foreground/65">
                  <tr>
                    <th className="py-2 pr-4 font-normal">Field path</th>
                    <th className="py-2 pr-4 font-normal">Records affected</th>
                    <th className="py-2 font-normal">Last stripped</th>
                  </tr>
                </thead>
                <tbody>
                  {fields.map((field) => (
                    <tr
                      key={field.field_path}
                      className="border-b border-black/5"
                    >
                      <td className="py-3 pr-4 font-mono text-xs">
                        {field.field_path}
                      </td>
                      <td className="py-3 pr-4">
                        {formatCount(field.records_affected)}
                      </td>
                      <td className="py-3 text-foreground/65">
                        {formatDate(field.last_applied)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
