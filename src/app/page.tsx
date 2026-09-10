import Landing from "@/components/landing";
import { createClient } from "@/lib/supabase/server";

export default async function Home() {
  let isSignedIn = false;
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    isSignedIn = user !== null;
  } catch {
    // No Supabase session (or env not configured) — landing renders signed-out.
    isSignedIn = false;
  }

  return <Landing isSignedIn={isSignedIn} />;
}
