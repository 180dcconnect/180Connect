import { AttentionList } from "@/components/attention-list";
import type { NeedsAttentionItem } from "@/lib/dashboard-metrics";

/**
 * Preview harness for the Needs Attention panel (F027), alongside
 * preview-invite / preview-search. Mock data only, no dashboard wiring.
 */
const mockItems: NeedsAttentionItem[] = [
  { id: "1", legalName: "Oxfam GB", outreachStatusLabel: "Initial outreach sent" },
  { id: "2", legalName: "Trussell Trust", outreachStatusLabel: "No response" },
  { id: "3", legalName: "Shelter", outreachStatusLabel: "Follow-up sent" },
];

export default function PreviewAttentionPage() {
  return (
    <main className="mx-auto max-w-2xl p-10">
      <h2 className="mb-4 text-xl font-black tracking-[-0.02em]">Needs attention</h2>
      <AttentionList items={mockItems} />
    </main>
  );
}
