import type { Metadata } from "next";
import NotFoundPage from "@/components/not-found-page";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Page not found | 180Connect",
  description:
    "This address isn't one of ours. Head back to 180Connect to find your way.",
};

/**
 * Every URL that matches no route lands here — Next treats the root
 * `not-found` as the app's global 404 (see the not-found file convention in
 * `node_modules/next/dist/docs/`). It is rendered inside the root layout, so it
 * inherits globals.css, the fonts and the staging banner, and needs no
 * `<html>`/`<body>` of its own.
 *
 * The session is read the same way the landing page reads it — `getClaims`
 * verifies the token locally rather than asking the Auth server, so a 404 pays
 * no network round trip just to choose between "Back to home" and "Go to the
 * app".
 */
export default async function NotFound() {
  let isSignedIn = false;
  try {
    const supabase = await createClient();
    const { data } = await supabase.auth.getClaims();
    isSignedIn = Boolean(data?.claims?.sub);
  } catch {
    // No Supabase session (or env not configured) — the page renders signed out.
    isSignedIn = false;
  }

  return <NotFoundPage isSignedIn={isSignedIn} />;
}
