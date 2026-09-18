"use server";

import { revalidatePath, updateTag } from "next/cache";
import { z } from "zod";

import { actorFailureMessage, getCurrentActor } from "@/lib/auth/actor";
import { reportError } from "@/lib/error-logging";
import { createClient } from "@/lib/supabase/server";
import { safeValidate } from "@/lib/validation";
import { checkWebsiteReachability } from "@/lib/website-reachability";
import type { WebsiteStatus } from "@/lib/website-validation";

const recheckSchema = z.object({ organisationId: z.uuid() });

export type RecheckWebsiteResult =
  | { ok: true; website: WebsiteStatus }
  | { ok: false; message: string };

/**
 * Re-runs the website reachability check fresh, bypassing the 1hr
 * `unstable_cache` behind `loadWebsite`.
 *
 * The Overview tab's Contactability card renders the cached verdict, so a
 * transient failure (or a checker bug like the HEAD-405 false negative) sticks
 * for up to an hour with no way to ask again. This is the explicit override:
 * a fresh DNS+HTTP check of the stored website, then the cache tag and the
 * record path are invalidated so the next render converges with what is
 * returned here.
 *
 * Gated on client:view — the same gate as the page that shows the verdict —
 * so viewers can retry a check they can already see.
 */
export async function recheckWebsiteAction(input: unknown): Promise<RecheckWebsiteResult> {
  const parsed = safeValidate(recheckSchema, input);
  if (!parsed.success) {
    return { ok: false, message: "That record could not be identified. Refresh and try again." };
  }

  const authorization = await getCurrentActor("client:view", { route: "/clients/[id]" });
  if (!authorization.ok) {
    return { ok: false, message: actorFailureMessage(authorization.reason) };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("organisations")
    .select("website")
    .eq("id", parsed.data.organisationId)
    .maybeSingle<{ website: string | null }>();
  if (error) {
    await reportError(error, {
      operation: "clients.recheck_website.load",
      organisationId: parsed.data.organisationId,
    });
    return { ok: false, message: "The website could not be loaded. Refresh and try again." };
  }

  let website: WebsiteStatus;
  try {
    website = await checkWebsiteReachability(data?.website ?? null);
  } catch (thrown) {
    await reportError(thrown, {
      operation: "clients.recheck_website.check",
      organisationId: parsed.data.organisationId,
    });
    return { ok: false, message: "The website check failed. Try again in a moment." };
  }

  // `updateTag`, not `revalidateTag`: this is read-your-own-writes — the retry
  // button refreshes the record right after, and must block on a fresh check
  // rather than serve the stale verdict while revalidating in the background.
  updateTag("website-reachability");
  revalidatePath(`/clients/${parsed.data.organisationId}`);

  return { ok: true, website };
}
