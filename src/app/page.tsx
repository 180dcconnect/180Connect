import Landing from "@/components/landing";
import { createClient } from "@/lib/supabase/server";

export default async function Home() {
  let isSignedIn = false;
  try {
    const supabase = await createClient();
    // getClaims verifies the token locally (see src/lib/auth/actor.ts) rather
    // than asking the Auth server, so the public landing page pays no network
    // round trip just to choose between "Sign in" and "Open the app".
    const { data } = await supabase.auth.getClaims();
    isSignedIn = Boolean(data?.claims?.sub);
  } catch {
    // No Supabase session (or env not configured) — landing renders signed-out.
    isSignedIn = false;
  }

  return <Landing isSignedIn={isSignedIn} />;
}
