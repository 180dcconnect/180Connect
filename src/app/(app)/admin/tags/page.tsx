import { redirect } from "next/navigation";
import { getViewingActor } from "@/lib/auth/actor";
import { hasPermission } from "@/lib/auth/permissions";
import { VIEW_ONLY_CONTROL_NOTE } from "@/lib/auth/view-only";
import { createClient } from "@/lib/supabase/server";
import { reportError } from "@/lib/error-logging";
import { CreateTagForm } from "./create-tag-form";
import { EditableTagList } from "./editable-tag-list";

export default async function TagsPage() {
  const authorization = await getViewingActor("tags:manage", {
    route: "/admin/tags",
  });
  if (!authorization.ok) {
    if (authorization.reason === "unauthenticated") redirect("/login");
    redirect("/dashboard?error=admin-access-required");
  }

  // Leadership reads the tag list and shapes none of it. `tags:manage` is what
  // every write on this screen asks for: the create action, the rename action,
  // the colour RPC and the delete RPC.
  const canManage = hasPermission(authorization.actor.role, "tags:manage");

  const supabase = await createClient();
  const { data: tags, error } = await supabase
    .from("tags")
    .select("id, name, colour")
    .order("name");

  if (error) {
    await reportError(error, { operation: "admin.tags.page_list" });
  }

  const existingTags = tags ?? [];

  return (
    <div className="min-h-screen bg-[#f4f4ef] px-6 py-10 sm:px-10 sm:py-12">
      <section className="mx-auto max-w-2xl rounded-2xl border border-black/[0.06] bg-white p-8 shadow-sm">
        <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-brand">
          Tags
        </p>
        {/* The title names what this reader can do here. "Create a tag" over a
            list leadership may only read would promise a form that is not on
            the page. */}
        <h1 className="mt-2 text-[clamp(2rem,4vw,2.75rem)] font-black leading-[1.05] tracking-[-0.03em]">
          {canManage ? "Create a tag" : "Tags"}
        </h1>
        <p className="mt-3 text-[15px] leading-[1.8] text-black/55">
          {canManage
            ? "Tags are shared across the whole team. Once created, any CAM can assign it to a client."
            : "The tags in use across the team. Every CAM can assign one to a client."}
        </p>
        {!canManage && (
          <p className="mt-3 text-[15px] leading-[1.8] text-black/45">
            {VIEW_ONLY_CONTROL_NOTE}
          </p>
        )}

        {error && (
          <p
            className="mt-5 rounded-2xl bg-red-50 p-4 text-sm font-bold text-red-800"
            role="alert"
          >
            The existing tag list could not be loaded. Please refresh and try again.
          </p>
        )}

        {canManage && <CreateTagForm />}

        <div className="mt-8">
          <h2 className="text-sm font-bold uppercase tracking-[0.08em] text-black/40">
            Existing tags
          </h2>
          {!error && <EditableTagList initialTags={existingTags} readOnly={!canManage} />}
        </div>
      </section>
    </div>
  );
}
