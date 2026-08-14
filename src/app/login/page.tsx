import Landing from "@/components/landing";
import { signedOutNotice } from "@/lib/auth/signed-out-notice";

/**
 * Signing in is a dialog over the landing page, not a page of its own — nobody
 * signs up, so there is no funnel to land in.
 *
 * This route still exists because a great deal points at it: the session guard
 * (`/login?signed_out=expired`), `logout()`, the password-reset confirmation,
 * and the dashboard/profile/admin guards all redirect here, and two of those
 * carry a notice in the query string. It renders the same landing page with the
 * dialog already open and the splash intro skipped.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const notice =
    params["password-reset"] === "success"
      ? {
          tone: "success" as const,
          message: "Password updated. Log in with your new password.",
        }
      : signedOutNotice(params.signed_out);

  return <Landing skipIntro notice={notice} />;
}
