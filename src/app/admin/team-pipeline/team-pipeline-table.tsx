import Link from "next/link";

import { formatOutreachStatus } from "@/lib/organisation-format";
import type { TeamPipelineClient } from "@/lib/admin/team-pipeline";

/**
 * F182 — the read-only team pipeline table. A server-rendered table is enough:
 * every interaction this view offers is navigation (a link to the client or a
 * filter URL), so there is no state worth a client component.
 * F183 — stalled rows wear a red badge so they surface inside the pipeline
 * view itself (AC2), not only in a separate report.
 */
export function TeamPipelineTable({ rows }: { rows: TeamPipelineClient[] }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-black/[0.06] bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-black/10">
              <th className="p-4 pb-3 text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/40">
                Client
              </th>
              <th className="p-4 pb-3 text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/40">
                Pipeline stage
              </th>
              <th className="p-4 pb-3 text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/40">
                Owning CAM
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((client) => (
              <tr key={client.id} className="border-b border-black/5 last:border-b-0">
                <td className="p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/clients/${client.id}`} className="font-bold hover:text-brand hover:underline">
                      {client.legal_name}
                    </Link>
                    {client.isStalled && (
                      <span
                        className="inline-block whitespace-nowrap rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.06em] text-red-700 ring-1 ring-red-200"
                        title={
                          client.stalledDaysWaiting != null
                            ? `No follow-up for ${client.stalledDaysWaiting} days`
                            : "Stalled — no follow-up"
                        }
                      >
                        Stalled{client.stalledDaysWaiting != null ? ` · ${client.stalledDaysWaiting}d` : ""}
                      </span>
                    )}
                  </div>
                </td>
                <td className="p-4">
                  <span className="inline-block whitespace-nowrap rounded-full bg-black/[0.06] px-2.5 py-1 text-xs font-bold">
                    {formatOutreachStatus(client.outreach_status)}
                  </span>
                </td>
                <td className="p-4 text-foreground/70">
                  {client.owner_name ?? <span className="text-foreground/40">Unassigned</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
