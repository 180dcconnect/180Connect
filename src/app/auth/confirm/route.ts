import { type NextRequest, NextResponse } from "next/server";
import {
  completeRecoveryLanding,
  invalidLinkResponse,
} from "@/lib/auth/recovery-landing";
import { inviteTokenFromForm } from "@/lib/auth/password-reset";
import { createClient } from "@/lib/supabase/server";

/**
 * Recovery and invite links of the `token_hash` shape (F004, F008).
 *
 * This is the shape to prefer: nothing is held in the browser that asked for
 * the reset or sent the invite, so the link still works when it is opened on a
 * phone or in a different browser. See `docs/auth/recovery-email.md` and
 * `docs/auth/invite-email.md` for the email templates that produce it.
 *
 * An invite lands here for the same reason recovery does — and then, unlike
 * recovery, it is NOT verified here. Verifying would consume the single-use
 * token before any password exists, stranding whoever opens the link without
 * finishing the form. Instead the hash rides on to `/reset-password`, which
 * verifies it when the password is submitted: opening the link as many times
 * as it takes burns nothing, and only completing the form consumes the token.
 * Recovery keeps verifying on landing — resetting an existing account's
 * password is the higher-stakes flow, and its session confinement assumes a
 * verified session from the first byte.
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

  if (type === "invite") {
    // Deferred verification: carry the hash to the password form untouched.
    // Trimmed and non-blank only — `verifyOtp` at submit time is the
    // validator, and a blank hash reads as a malformed link, same as a
    // missing one.
    const inviteToken = inviteTokenFromForm(tokenHash);
    if (!inviteToken) return invalidLinkResponse(request, "invite");
    const url = new URL("/reset-password", request.url);
    url.searchParams.set("flow", "invite");
    url.searchParams.set("token_hash", inviteToken);
    return NextResponse.redirect(url);
  }

  // Past the invite branch above, only recovery remains.
  return completeRecoveryLanding(
    request,
    "password-recovery-token-verification",
    "recovery",
    async () => {
      const supabase = await createClient();
      return supabase.auth.verifyOtp({ token_hash: tokenHash, type: "recovery" });
    },
  );
}
