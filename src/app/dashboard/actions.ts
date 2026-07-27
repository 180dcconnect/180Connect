"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { signOutAndReport } from "@/lib/auth/sign-out";
import { SIGNED_OUT, SIGNED_OUT_FAILED } from "@/lib/auth/signed-out-notice";

export async function logout() {
  // `signOutAndReport` never throws, so the redirect below always runs: a user
  // who pressed "log out" is never left on an authenticated page, even when the
  // server-side sign-out failed. The marker says which of the two happened, so
  // the login page can confirm it; the failure detail itself is recorded, never
  // shown, so no error text or stack trace reaches the browser.
  const supabase = await createClient();
  const signedOut = await signOutAndReport(supabase);

  redirect(`/login?signed_out=${signedOut ? SIGNED_OUT : SIGNED_OUT_FAILED}`);
}
