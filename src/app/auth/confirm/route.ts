import { type NextRequest } from "next/server";
import {
  completeRecoveryLanding,
  invalidLinkResponse,
} from "@/lib/auth/recovery-landing";
import { createClient } from "@/lib/supabase/server";

/**
 * Recovery and invite links of the `token_hash` shape (F004, F008).
 *
 * This is the shape to prefer: nothing is held in the browser that asked for
 * the reset or sent the invite, so the link still works when it is opened on a
 * phone or in a different browser. See `docs/auth/recovery-email.md` and
 * `docs/auth/invite-email.md` for the email templates that produce it.
 *
 * An invite lands here for the same reason recovery does: verifying it opens a
 * real Supabase session, and the invited person needs to choose a password
 * before that session is good for anything else — exactly the "set a password"
 * step recovery already has. Landing on `/reset-password` reuses that step
 * rather than building a second one; the copy there is generic enough to read
 * correctly either way ("choose a new password" also describes choosing the
 * first one).
 */
export async function GET(request: NextRequest) {
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const type = request.nextUrl.searchParams.get("type");

  // Only these two. This route must never become a general-purpose way to turn
  // any emailed token into a session.
  if (!tokenHash || (type !== "recovery" && type !== "invite")) {
    return invalidLinkResponse(request);
  }

  return completeRecoveryLanding(
    request,
    type === "invite" ? "invite-token-verification" : "password-recovery-token-verification",
    async () => {
      const supabase = await createClient();
      return supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    },
  );
}
