"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { signOutAndReport } from "@/lib/auth/sign-out";

export async function logout() {
  // `signOutAndReport` never throws, so the redirect below always runs: a user
  // who pressed "log out" is never left on an authenticated page, even when the
  // server-side sign-out failed. The failure is recorded, not surfaced — the
  // user only ever sees /login, no error detail and no stack trace.
  const supabase = await createClient();
  await signOutAndReport(supabase);

  redirect("/login");
}
