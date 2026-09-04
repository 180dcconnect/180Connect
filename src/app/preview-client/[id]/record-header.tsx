import { loadClient, loadScore } from "@/app/clients/[id]/load-record";
import { PriorityDial } from "./priority-dial";

// Preview-only stripped header. Real src/app/clients/[id]/record-header.tsx untouched.
// Copy final JSX back to the real file when happy.

export async function RecordHeader({ organisationId }: { organisationId: string }) {
  const [client, { score }] = await Promise.all([
    loadClient(organisationId),
    loadScore(organisationId),
  ]);

  return (
    <div className="relative flex items-center justify-between gap-4">
      <h1 className="font-body text-[clamp(2rem,4.5vw,3.25rem)] leading-[1.02] font-black tracking-[-0.04em] text-[#1c1a18]">
        {client.legal_name}
      </h1>

      <div className="flex shrink-0 items-center justify-center self-center py-1">
        <PriorityDial
          band={score?.priority_band ?? null}
          factors={score?.score_factors ?? null}
          score={score?.priority_score ?? null}
        />
      </div>
    </div>
  );
}

