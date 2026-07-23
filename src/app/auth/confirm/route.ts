import { NextResponse, type NextRequest } from "next/server";
import { logAuthApiHealth, logAuthError } from "@/lib/auth/observability";
import { RESET_LINK_ERROR } from "@/lib/auth/password-reset";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const type = request.nextUrl.searchParams.get("type");
  const errorUrl = new URL("/reset-password", request.url);
  errorUrl.searchParams.set("error", RESET_LINK_ERROR);

  if (!tokenHash || type !== "recovery") return NextResponse.redirect(errorUrl);

  const startedAt = Date.now();
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: "recovery",
    });
    logAuthApiHealth("password-recovery-token-verification", !error, startedAt, {
      error_code: error?.code,
    });

    if (error || !data.user) {
      if (error) logAuthError("authentication.password_recovery_link_rejected", error, { error_code: error.code });
      return NextResponse.redirect(errorUrl);
    }

    const response = NextResponse.redirect(new URL("/reset-password", request.url));
    response.cookies.set("180connect-password-recovery", data.user.id, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: Number(process.env.PASSWORD_RESET_WINDOW_SECONDS ?? 3600),
      path: "/",
    });
    return response;
  } catch (error) {
    logAuthApiHealth("password-recovery-token-verification", false, startedAt);
    logAuthError("authentication.password_recovery_link_rejected", error);
    return NextResponse.redirect(errorUrl);
  }
}

