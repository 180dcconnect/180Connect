import { type NextRequest } from "next/server";
import {
  completeRecoveryLanding,
  invalidLinkResponse,
} from "@/lib/auth/recovery-landing";
import { createClient } from "@/lib/supabase/server";

/**
 * Recovery links of the `token_hash` shape (F004).
 *
 * This is the shape to prefer: nothing is held in the browser that asked for
 * the reset, so the link still works when it is opened on a phone or in a
 * different browser. See the README for the email template that produces it.
 */
export async function GET(request: NextRequest) {
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const type = request.nextUrl.searchParams.get("type");

  // Recovery only. This route must never become a general-purpose way to turn
  // any emailed token into a session.
  if (!tokenHash || type !== "recovery") return invalidLinkResponse(request);

  return completeRecoveryLanding(
    request,
    "password-recovery-token-verification",
    async () => {
      const supabase = await createClient();
      return supabase.auth.verifyOtp({ token_hash: tokenHash, type: "recovery" });
    },
  );
}
