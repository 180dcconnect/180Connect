import { loadClient } from "@/app/clients/[id]/load-record";

// Preview-only stripped header. Real src/app/clients/[id]/record-header.tsx untouched.
// Copy final JSX back to the real file when happy.

export async function RecordHeader({ organisationId }: { organisationId: string }) {
  const client = await loadClient(organisationId);

  return (
    <div className="relative">
      <h1 className="font-body text-[clamp(2rem,4.5vw,3.25rem)] leading-[1.02] font-black tracking-[-0.04em] text-[#1c1a18]">
        {client.legal_name}
      </h1>
    </div>
  );
}
