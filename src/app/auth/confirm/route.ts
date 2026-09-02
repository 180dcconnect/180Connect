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
const BOT_USER_AGENT_REGEX =
  /whatsapp|facebookexternalhit|slackbot|twitterbot|telegrambot|discordbot|applebot|linkedinbot|skypeteamsbot|googlebot|bingbot|duckduckbot|bytespider|yandex|crawling|crawler|spider|preview|fetch/i;

export async function GET(request: NextRequest) {
  const userAgent = request.headers.get("user-agent") || "";
  const purpose =
    request.headers.get("purpose") ||
    request.headers.get("sec-purpose") ||
    request.headers.get("x-purpose") ||
    request.headers.get("x-moz");

  // If requested by a link-preview crawler (e.g. WhatsApp, Slack, Facebook) or prefetcher,
  // return metadata without consuming the single-use token.
  if (
    purpose === "prefetch" ||
    purpose === "preview" ||
    BOT_USER_AGENT_REGEX.test(userAgent)
  ) {
    return new Response(
      `<!DOCTYPE html>
<html>
  <head>
    <title>Accept Invitation · 180Connect</title>
    <meta property="og:title" content="Accept Invitation · 180Connect" />
    <meta property="og:description" content="You've been invited to join 180Connect." />
  </head>
  <body>
    <p>Open this link in your web browser to accept your invitation.</p>
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

  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const type = request.nextUrl.searchParams.get("type");

  // Only these two. This route must never become a general-purpose way to turn
  // any emailed token into a session.
  if (!tokenHash || (type !== "recovery" && type !== "invite")) {
    return invalidLinkResponse(request, type === "invite" ? "invite" : "recovery");
  }

  return completeRecoveryLanding(
    request,
    type === "invite" ? "invite-token-verification" : "password-recovery-token-verification",
    type,
    async () => {
      const supabase = await createClient();
      return supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    },
  );
}
