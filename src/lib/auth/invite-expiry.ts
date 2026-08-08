/**
 * The shared invite/password-reset link expiry (F010).
 *
 * One number, not two, because Supabase enforces a single `otp_expiry` for
 * every email-based token it issues — invite and password-reset links alike
 * (`supabase/config.toml`). There is no way to give invites a longer or
 * shorter window than recovery without either building an expiry check this
 * repo owns independently of Supabase's (not done — the token is still
 * Supabase's alone to mint, store and expire, see `invite.ts`'s module doc) or
 * accepting that changing one changes both.
 *
 * Decided: 24 hours (F010, 8 Aug 2026) — long enough that an invite sent on a
 * Friday is still good on Monday, without leaving a stale link usable
 * indefinitely. `PASSWORD_RESET_WINDOW_SECONDS` (`password-reset.ts`) is kept
 * at the same 86400 seconds, and `supabase/config.toml`'s `otp_expiry` must be
 * set to 86400 in every hosted environment too — that setting lives in the
 * Supabase dashboard, not this repo, so nothing here enforces it automatically.
 * See `docs/auth/invite-email.md`.
 *
 * Split out from `invite.ts` rather than living there: `invite.ts` pulls in
 * `sendEmail` and the Supabase admin client, neither of which belongs in a
 * client bundle, but the admin UI's pending-invites list
 * (`src/app/admin/users/pending-invites-list.tsx`, a client component) needs
 * this value to show whether a pending invite has expired. Importing this
 * module instead keeps that bundle free of server-only code.
 */

export const INVITE_EXPIRY_HOURS = 24;

/** The instant an invite sent at `invitedAt` stops being valid. */
export function inviteExpiresAt(
  invitedAt: string | Date,
  expiryHours: number = INVITE_EXPIRY_HOURS,
): Date {
  const invited = typeof invitedAt === "string" ? new Date(invitedAt) : invitedAt;
  return new Date(invited.getTime() + expiryHours * 60 * 60 * 1000);
}

/** Whether an invite sent at `invitedAt` is past its expiry window, as of `now`. */
export function isInviteExpired(
  invitedAt: string | Date,
  expiryHours: number = INVITE_EXPIRY_HOURS,
  now: Date = new Date(),
): boolean {
  return inviteExpiresAt(invitedAt, expiryHours).getTime() <= now.getTime();
}
