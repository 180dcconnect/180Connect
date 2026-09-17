// F188/F189/F190/F194 — the team's shared tags.
//
// Rebuilt on the app's own system (docs/app-design-system.md) with the Data
// imports screens as the structure reference, which is what the page below is:
//
//   1. A heading and a line saying what a tag is and who may do what with it.
//   2. A rail under it answering the question people arrive with: which tags
//      exist, and is any of them unused?
//   3. The create card, then the list.
//
// It was one white `rounded-2xl` box on a warm bone ground with an uppercase
// brand-green eyebrow ("TAGS"), a form of two grey fields and nine colour dots,
// and a list of `rounded-full` pills whose uncoloured state rendered in
// `bg-[--brand]/10 text-[--brand]` — a variable that is not a Tailwind colour
// and a green that is 2.3:1 on white.
//
// ── Two things this page needs and did not have ──
//
// **How many clients carry a tag.** `delete_unused_tag` refuses an in-use tag
// with its assignment count, and that count is the only thing that tells a person
// whether deleting is even possible — so the page reads it and puts it on the
// row. It is one indexed count per tag (`org_tags_tag_id_idx`), and it is read
// for every role: leadership keeps the numbers (`AGENTS.md` §Roles).
//
// **Who sees what.** `tags:manage` is held by CAMs (create, assign, recolour) and
// by admins, who alone may rename or delete a shared tag. A viewer reaches this
// screen — `canView` opens every admin screen to leadership — and gets the whole
// reading with no control at all. The page asks the same questions the actions
// ask (`hasPermission` for creating, `canRestructureTags` for renaming and
// deleting), never the role.
//
// The root element is a `div`, not a `main`: the admin layout's AppShell already
// renders the `main` this is slotted into.

import { redirect } from "next/navigation";

import { getViewingActor } from "@/lib/auth/actor";
import { adminRouteDestination } from "@/lib/auth/admin-route";
import { canRestructureTags, hasPermission } from "@/lib/auth/permissions";
import { VIEW_ONLY_CONTROL_NOTE } from "@/lib/auth/view-only";
import { reportError } from "@/lib/error-logging";
import { createClient } from "@/lib/supabase/server";
import { CREATE_TAG_PERMISSION } from "@/lib/tags/create-tag-core";
import { SET_TAG_COLOUR_PERMISSION } from "@/lib/tags/set-tag-colour-core";
import { Group, Rise, Stage } from "@/components/dashboard-stage";
import { TagsPanel } from "./tags-panel";
import type { TagEntry, TagUsage } from "./editable-tag-list";

/**
 * The reading under the heading: how many tags the team has, how many are on at
 * least one client, and how many nobody uses.
 *
 * Nothing renders on a first visit, when there are no tags at all — the create
 * card below already says what a tag is, and a line above it repeating that would
 * be the same sentence twice.
 *
 * The counts are `{ count: "exact" }` reads, one per tag against an indexed
 * column. They are shown only when every one of them came back: "unused" is the
 * one number on this screen somebody acts on (it is what makes a tag deletable),
 * and a count that silently failed would read as a zero.
 */
function TagsRail({
  total,
  onAClient,
  unused,
}: {
  total: number;
  onAClient: number;
  unused: number;
}) {
  if (total === 0) return null;

  return (
    <p className="mt-3 flex flex-wrap items-center gap-x-1.5 font-body text-sm text-dim">
      <span className="font-semibold tabular-nums text-ink">{total}</span>
      {total === 1 ? "tag" : "tags"}
      <span aria-hidden="true">·</span>
      <span className="font-semibold tabular-nums text-ink">{onAClient}</span>
      on at least one client
      {unused > 0 && (
        <>
          <span aria-hidden="true">·</span>
          <span className="font-semibold tabular-nums text-ink">{unused}</span>
          never used
        </>
      )}
    </p>
  );
}

export default async function TagsPage() {
  const authorization = await getViewingActor("tags:manage", {
    route: "/admin/tags",
  });
  if (!authorization.ok) redirect(adminRouteDestination(authorization.reason));

  const role = authorization.actor.role;
  // Whether a control may be drawn — each one asking the permission its action
  // asks, so the two cannot drift apart.
  const canCreate = hasPermission(role, CREATE_TAG_PERMISSION);
  // Same question the colour action asks (`tags:manage`). A CAM holds it; a
  // viewer does not, and used to be offered "Change colour" anyway — a control
  // whose only possible outcome was a refusal.
  const canRecolour = hasPermission(role, SET_TAG_COLOUR_PERMISSION);
  const canRestructure = canRestructureTags(role);

  const supabase = await createClient();
  const { data: tags, error } = await supabase
    .from("tags")
    .select("id, name, colour")
    .order("name");

  if (error) {
    await reportError(error, { operation: "admin.tags.page_list" });
  }

  const existingTags: TagEntry[] = (tags ?? []).map((tag) => ({
    id: tag.id,
    name: tag.name,
    colour: tag.colour,
  }));

  // How many clients carry each tag. One exact count per tag, against the index
  // `org_tags_tag_id_idx` exists for. A failed count stays `null` all the way to
  // the row: it must never be rendered as a number nobody read.
  const usageResults = await Promise.all(
    existingTags.map((tag) =>
      supabase
        .from("org_tags")
        .select("id", { count: "exact", head: true })
        .eq("tag_id", tag.id),
    ),
  );

  const usageById: TagUsage = {};
  let countsFailed = false;
  usageResults.forEach((result, index) => {
    const tag = existingTags[index];
    if (result.error) {
      countsFailed = true;
      usageById[tag.id] = null;
      return;
    }
    usageById[tag.id] = result.count ?? null;
  });

  if (countsFailed) {
    // No tag ids in the context: this is a count of a shared label, and the row
    // that failed is already visible on the screen as "the count could not be
    // read" (`docs/data-lifecycle-policy.md` §5.5).
    await reportError(new Error("A tag usage count could not be read."), {
      operation: "admin.tags.page_usage_counts",
      tagCount: existingTags.length,
    });
  }

  const counts = Object.values(usageById);
  const countsComplete = counts.every((count) => count !== null);
  const onAClient = counts.filter((count) => count !== null && count > 0).length;
  const unused = counts.filter((count) => count === 0).length;

  return (
    <div className="min-h-screen bg-[#f4f4ef] px-4 py-8 sm:px-8 sm:py-10 xl:px-12 xl:py-12">
      <Stage className="w-full space-y-6">
        <Rise>
          <h1 className="font-body text-[clamp(2rem,4vw,2.75rem)] leading-[1] font-semibold tracking-[-0.03em] text-ink">
            Tags
          </h1>
          <p className="mt-3 font-body text-sm leading-[1.7] text-dim">
            A tag is a label the whole team shares. Any CAM can put one on a
            client and the client list can be filtered by them &mdash; they are
            how the team marks a record as urgent, funded, or anything else worth
            sorting by.
          </p>
          {countsComplete && (
            <TagsRail
              total={existingTags.length}
              onAClient={onAClient}
              unused={unused}
            />
          )}
        </Rise>

        {/*
          Leadership reaches this screen and changes nothing on it. The create
          card is where the one write used to sit, so the note sits there
          instead — the same sentence a refused write would have produced, and
          the only place on the page that mentions it. The list below keeps
          every reading: the names, the colours and how many clients carry each.
        */}
        {!canCreate && (
          <Rise>
            <p className="rounded-panel border border-dashed border-rule bg-white px-5 py-4 font-body text-sm leading-[1.65] text-dim">
              {VIEW_ONLY_CONTROL_NOTE}
            </p>
          </Rise>
        )}

        {error ? (
          <Group>
            <Rise>
              {/* The empty list is not drawn: "No tags yet" would be a lie about a
                  read that failed. Nothing here has changed anything. */}
              <p
                role="alert"
                className="rounded-panel border border-rule bg-white px-5 py-6 font-body text-sm leading-[1.65] text-stop"
              >
                The team&rsquo;s tags could not be read just now, so there is
                nothing to show. Nothing has been changed. Refresh the page to
                try again.
              </p>
            </Rise>
          </Group>
        ) : (
          <TagsPanel
            initialTags={existingTags}
            usageById={usageById}
            canCreate={canCreate}
            canRecolour={canRecolour}
            canRestructure={canRestructure}
          />
        )}
      </Stage>
    </div>
  );
}
