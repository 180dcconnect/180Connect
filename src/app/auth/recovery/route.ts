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
const BOT_USER_AGENT_REGEX =
  /whatsapp|facebookexternalhit|slackbot|twitterbot|telegrambot|discordbot|applebot|linkedinbot|skypeteamsbot|googlebot|bingbot|duckduckbot|bytespider|yandex|crawling|crawler|spider|preview|fetch/i;

export async function GET(request: NextRequest) {
  const userAgent = request.headers.get("user-agent") || "";
  const purpose =
    request.headers.get("purpose") ||
    request.headers.get("sec-purpose") ||
    request.headers.get("x-purpose") ||
    request.headers.get("x-moz");

  if (
    purpose === "prefetch" ||
    purpose === "preview" ||
    BOT_USER_AGENT_REGEX.test(userAgent)
  ) {
    return new Response(
      `<!DOCTYPE html>
<html>
  <head>
    <title>Reset Password · 180Connect</title>
    <meta property="og:title" content="Reset Password · 180Connect" />
  </head>
  <body>
    <p>Open this link in your web browser to reset your password.</p>
  </body>
</html>`,
      {
        status: 200,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store, no-cache, must-revalidate",
        },
      },
    );
  }

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
