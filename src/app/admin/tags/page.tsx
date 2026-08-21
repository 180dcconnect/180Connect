import { redirect } from "next/navigation";
import { getCurrentActor } from "@/lib/auth/actor";
import { createClient } from "@/lib/supabase/server";
import { reportError } from "@/lib/error-logging";
import { AssignTagForm } from "./assign-tag-form";

export default async function TagsPage() {
  const authorization = await getCurrentActor("client:edit", {
    route: "/admin/tags",
  });
  if (!authorization.ok) {
    if (authorization.reason === "unauthenticated") redirect("/login");
    redirect("/dashboard?error=admin-access-required");
  }

  const supabase = await createClient();
  const { data: tags, error } = await supabase
    .from("tags")
    .select("id, name")
    .order("name");

  if (error) {
    await reportError(error, { operation: "admin.tags.page_list" });
  }

  const existingTags = tags ?? [];

  return (
    <div className="min-h-screen bg-[#f4f4ef] px-6 py-10 sm:px-10 sm:py-12">
      <section className="mx-auto max-w-2xl rounded-2xl border border-black/[0.06] bg-white p-8 shadow-sm">
        <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[--brand]">
          Tags
        </p>
        <h1 className="mt-2 text-[clamp(2rem,4vw,2.75rem)] font-black leading-[1.05] tracking-[-0.03em]">
          Assign a tag
        </h1>
        <p className="mt-3 text-[15px] leading-[1.8] text-black/55">
          Assign an existing tag to a client by organisation id.
        </p>

        {error && (
          <p
            className="mt-5 rounded-2xl bg-red-50 p-4 text-sm font-bold text-red-800"
            role="alert"
          >
            The tag list could not be loaded. Please refresh and try again.
          </p>
        )}

        <AssignTagForm tags={existingTags} />
      </section>
    </div>
  );
}
