import { redirect } from "next/navigation";
import { getCurrentActor } from "@/lib/auth/actor";
import { adminRouteDestination } from "@/lib/auth/admin-route";
import { InlineAlert } from "@/components/ui/inline-alert";
import { Group, Rise, Stage } from "@/components/dashboard-stage";
import { loadFilterActivity, loadRules } from "./actions";
import { FilterActivityPanel } from "./filter-activity";
import { RulesPanel } from "./rules-panel";

/**
 * `/settings/data-handling-rules` — F246 Public Data Handling Rules, F247
 * Personal Data Exclusion.
 *
 * Admins decide which personal details are kept out of the data the platform
 * imports from public registers. The rules are enforced by the ingestion runner
 * (src/lib/ingestion/apply-data-handling.ts) at the single point where external
 * data enters, as the data handling policy §2 commits to.
 *
 * ── Who this is for ──
 *
 * An admin, not a developer (AGENTS.md, "Who will maintain this app"). A rule is
 * stored as a source, a path into an API response and a kind; on screen it is a
 * "protection" with a plain name — "Trustees' home addresses" — from
 * src/lib/data-handling-catalogue.ts. Paths and sources only appear inside the
 * collapsed developer form.
 *
 * ── The layout ──
 *
 * Filed Record (`docs/app-design-system.md`), as the other settings pages: a
 * heading, one rail of facts, then a card per job — what is protected, turning a
 * protection on, and what has been removed so far.
 */
export default async function DataHandlingRulesPage() {
  const authorization = await getCurrentActor("user:manage", {
    route: "/settings/data-handling-rules",
  });
  if (!authorization.ok) redirect(adminRouteDestination(authorization.reason));

  const [{ rules, version, error }, activity] = await Promise.all([
    loadRules(),
    loadFilterActivity(),
  ]);

  const onCount = rules.filter((rule) => rule.is_active).length;

  return (
    <div className="min-h-screen bg-[#f4f4ef] px-6 py-10 sm:px-10 sm:py-12">
      <Stage className="w-full space-y-8">
        <Rise>
          <h1 className="font-body text-[clamp(2rem,4vw,2.75rem)] leading-[1] font-semibold tracking-[-0.03em] text-ink">
            Data handling rules
          </h1>
          <p className="mt-5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-dim">
            <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-go" />
            <span>
              <span className="font-semibold text-ink">
                {onCount} {onCount === 1 ? "protection" : "protections"} on
              </span>
              {" · "}
              Personal details are removed before anything imported is saved
            </span>
          </p>
        </Rise>

        {error && (
          <Rise>
            <InlineAlert variant="page" message={`${error} Refresh the page to try again.`} />
          </Rise>
        )}

        <Group className="space-y-4">
          <RulesPanel initialRules={rules} initialVersion={version} />
          <Rise>
            <FilterActivityPanel activity={activity} />
          </Rise>
        </Group>
      </Stage>
    </div>
  );
}
