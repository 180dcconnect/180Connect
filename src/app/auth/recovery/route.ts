import { NextResponse, type NextRequest } from "next/server";
import { logAuthApiHealth, logAuthError } from "@/lib/auth/observability";
import { RESET_LINK_ERROR } from "@/lib/auth/password-reset";
import { createClient } from "@/lib/supabase/server";

const recoveryCookie = "180connect-password-recovery";

function invalidLinkResponse(request: NextRequest) {
  const url = new URL("/reset-password", request.url);
  url.searchParams.set("error", RESET_LINK_ERROR);
  return NextResponse.redirect(url);
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const providerError = request.nextUrl.searchParams.get("error");
  const startedAt = Date.now();

  if (!code || providerError) return invalidLinkResponse(request);

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    logAuthApiHealth("password-recovery-code-exchange", !error, startedAt, {
      error_code: error?.code,
    });

    if (error || !data.user) {
      if (error) {
        logAuthError("authentication.password_recovery_link_rejected", error, {
          error_code: error.code,
        });
      }
      return invalidLinkResponse(request);
    }

    const response = NextResponse.redirect(new URL("/reset-password", request.url));
    response.cookies.set(recoveryCookie, data.user.id, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: Number(process.env.PASSWORD_RESET_WINDOW_SECONDS ?? 3600),
      path: "/",
    });
    return response;
  } catch (error) {
    logAuthApiHealth("password-recovery-code-exchange", false, startedAt);
    logAuthError("authentication.password_recovery_link_rejected", error);
    return invalidLinkResponse(request);
  }
}

