// The heading block every Artificial Intelligence tab shares: title and the
// group's tab row.
//
// Same pattern as `data-imports-header.tsx`: the tab row is static — links and
// the current route — so switching tabs leaves the header pixel-identical
// while only the body below it swaps. Whatever a page needs under the tabs (a
// description, a scope banner) is passed as children, so this component stays
// the part that is genuinely common.

import { GroupTabs } from "@/components/ui/group-tabs";
import { getCurrentActor } from "@/lib/auth/actor";
import { aiTabsFor } from "./ai-group";

/**
 * Per-route heading. Keyed by the same href the tab row uses, so a tab that
 * exists here and a tab that exists there cannot disagree.
 */
const HEADINGS: Record<string, { title: string }> = {
  "/admin/ai-generations": { title: "AI generation history" },
  "/admin/ml-readiness": { title: "Machine Learning" },
  "/admin/email-lab": { title: "Email prompt lab" },
};

export async function AiHeader({
  current,
  children,
}: {
  /** The route being rendered — picks the title and selects the tab. */
  current: keyof typeof HEADINGS | string;
  /** Description, scope banner, or whatever else sits under the tab row. */
  children?: React.ReactNode;
}) {
  const heading = HEADINGS[current];
  if (!heading) return null;
  const { title } = heading;

  // The row shows only the tabs this role's pages would let it into. The
  // profile read is request-cached, so the AppShell above already paid for it.
  const actor = await getCurrentActor();
  const tabs = actor.ok ? aiTabsFor(actor.actor.role) : [];

  return (
    <>
      <h1 className="font-body text-[clamp(2rem,4vw,2.75rem)] leading-[1] font-semibold tracking-[-0.03em] text-ink">
        {title}
      </h1>
      <GroupTabs className="mt-4" tabs={tabs} current={current} />
      {children}
    </>
  );
}
