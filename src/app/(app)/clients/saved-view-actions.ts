"use server";

import { revalidatePath } from "next/cache";
import { actorFailureMessage, getCurrentActor } from "@/lib/auth/actor";
import { createClient } from "@/lib/supabase/server";
import { reportError } from "@/lib/error-logging";
import { MAX_SAVED_VIEWS, MAX_VIEW_NAME_LENGTH } from "./saved-view-filters";
import { deleteView, saveView, type SavedViewDb } from "./saved-view-writes";

export type SavedViewState = {
  status: "idle" | "error" | "success";
  message?: string;
};

/**
 * The form's params as the page saw them: one entry per key, with a repeated key
 * (F053/F054/F056 multi-select writes a hidden input per chosen value) arriving as
 * an array. `getAll`, not `entries`-then-`fromEntries`, or a three-city filter
 * would silently save as its last city only.
 */
function formFilterParams(formData: FormData): Record<string, string | string[]> {
  const params: Record<string, string | string[]> = {};
  for (const key of new Set(formData.keys())) {
    const values = formData.getAll(key).filter((v): v is string => typeof v === "string");
    if (values.length === 0) continue;
    params[key] = values.length === 1 ? values[0] : values;
  }
  return params;
}

/**
 * The wiring half of F066's writes — the real client behind the structural
 * interface the decisions in `saved-view-writes.ts` are tested against.
 *
 * Every statement runs as the caller, so RLS (matrix §3.17) is what actually
 * confines these rows: the insert policy's `with check` refuses a `user_id` that is
 * not `auth.uid()`, and the delete policy scopes the statement to the caller's own
 * rows. The `user_id` arguments below are belt and braces, not the guard.
 */
async function savedViewDb(): Promise<SavedViewDb> {
  const supabase = await createClient();
  return {
    async countViews(userId) {
      const { count, error } = await supabase
        .from("saved_views")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId);
      return { count: count ?? null, error };
    },
    async insertView(userId, name, filters) {
      const { error } = await supabase
        .from("saved_views")
        .insert({ user_id: userId, name, filters });
      return { error };
    },
    async deleteView(userId, id) {
      const { error } = await supabase
        .from("saved_views")
        .delete()
        .eq("id", id)
        .eq("user_id", userId);
      return { error };
    },
  };
}

/**
 * F066 AC1 — save the filter combination currently on the list under a name.
 *
 * The filters arrive in the form rather than from the URL, because a server action
 * has no URL: the page writes a hidden input per active filter, from the same
 * `searchParams` the list itself was built from. What gets stored is therefore what
 * produced the list the CAM was looking at, not a re-derivation of it.
 */
export async function saveViewAction(
  _previousState: SavedViewState,
  formData: FormData,
): Promise<SavedViewState> {
  const authorization = await getCurrentActor("client:view", { route: "/clients" });
  if (!authorization.ok) {
    return { status: "error", message: actorFailureMessage(authorization.reason) };
  }

  const outcome = await saveView(
    await savedViewDb(),
    authorization.actor.id,
    formData.get("name"),
    formFilterParams(formData),
  );

  if (outcome.ok) {
    revalidatePath("/clients");
    return { status: "success", message: `Saved “${outcome.name}”.` };
  }

  switch (outcome.reason) {
    case "invalid_name":
      return {
        status: "error",
        message: `Give the view a name of up to ${MAX_VIEW_NAME_LENGTH} characters.`,
      };
    // Not logged: two views by one name is an ordinary thing to try, and the CAM
    // fixes it by typing a different one.
    case "duplicate_name":
      return { status: "error", message: "You already have a view with that name." };
    case "limit_reached":
      return {
        status: "error",
        message: `You have ${MAX_SAVED_VIEWS} saved views. Delete one before saving another.`,
      };
    default:
      await reportError(outcome.error, { operation: "clients.saved_view_save" });
      return { status: "error", message: "Could not save this view. Try again." };
  }
}

/** F066 AC3 — delete a view the CAM no longer needs. */
export async function deleteViewAction(
  _previousState: SavedViewState,
  formData: FormData,
): Promise<SavedViewState> {
  const authorization = await getCurrentActor("client:view", { route: "/clients" });
  if (!authorization.ok) {
    return { status: "error", message: actorFailureMessage(authorization.reason) };
  }

  const outcome = await deleteView(
    await savedViewDb(),
    authorization.actor.id,
    formData.get("id"),
  );

  if (outcome.ok) {
    revalidatePath("/clients");
    return { status: "success", message: "View deleted." };
  }

  if (outcome.reason === "write_failed") {
    await reportError(outcome.error, { operation: "clients.saved_view_delete" });
  }
  return { status: "error", message: "Could not delete this view. Try again." };
}
