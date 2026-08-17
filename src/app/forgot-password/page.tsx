import type { Metadata } from "next";

import Landing from "@/components/landing";

export const metadata: Metadata = { title: "Reset password | 180Connect" };

/**
 * Resetting a password is a panel of the auth dialog, not a page of its own —
 * the same door as signing in, one step further along.
 *
 * The route stays because the sign-in panel is not the only way here: it is on
 * the allowlist in `lib/auth/password-reset.ts` (the paths a user with a pending
 * reset is not trapped away from), and it is a link people are sent and bookmark.
 * It renders the landing page with the dialog already open on the reset panel
 * and the splash intro skipped.
 */
export default function ForgotPasswordPage() {
  return <Landing skipIntro />;
}
