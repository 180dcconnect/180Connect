import { type NextRequest } from "next/server";
import {
  completeRecoveryLanding,
  invalidLinkResponse,
} from "@/lib/auth/recovery-landing";
import { createClient } from "@/lib/supabase/server";

/**
 * Recovery links of the PKCE `code` shape (F004) — the `redirectTo` this app
 * asks for in `src/app/forgot-password/actions.ts`.
 *
 * The exchange needs the code verifier Supabase left in the requesting
 * browser, so this only succeeds where the reset was requested. Opening the
 * link elsewhere fails as an invalid link, which is why the README points the
 * email template at `/auth/confirm` instead.
 */
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const providerError = request.nextUrl.searchParams.get("error");

  if (!code || providerError) return invalidLinkResponse(request);

  return completeRecoveryLanding(
    request,
    "password-recovery-code-exchange",
    "recovery",
    async () => {
      const supabase = await createClient();
      return supabase.auth.exchangeCodeForSession(code);
    },
  );
}
