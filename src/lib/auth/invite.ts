/**
 * The invite decision (F008), separated from the Server Action that calls it —
 * same reasoning as `src/lib/auth/login.ts`: a "use server" module cannot be
 * imported by `node --test`, so the part worth testing (domain restriction, the
 * duplicate-email check, the shape of every outcome) lives here behind
 * injectable clients, and the action keeps only client construction.
 *
 * **The email is ours, not Supabase's.** This used to call
 * `auth.admin.inviteUserByEmail`, which mints the token *and* sends it from
 * Supabase's own template and sending domain. It now calls `generateLink`,
 * which mints the same token and sends nothing, and hands the link to
 * `sendEmail` (`src/lib/email/send.ts`). Three things follow, and all three are
 * the point:
 *
 *   - the copy is in this repo and reviewable, rather than in a dashboard field;
 *   - it goes out from our verified sender, not Supabase's;
 *   - a failed send is *visible*. `inviteUserByEmail` reports success as soon as
 *     Supabase accepts the request, so an invite that never arrived looked
 *     identical to one that did.
 *
 * What did not change: Supabase is still the token authority. It generates,
 * stores and expires the token, and `data.invited_by_user_id` still travels
 * through `raw_user_meta_data` into `app.handle_new_auth_user`, which is what
 * stamps `invited_at` and `invited_by_user_id`
 * (`supabase/migrations/20260804090000_add_user_invite_tracking.sql`).
 */

import { z } from "zod";

import { sendEmail } from "../email/send.ts";
import { logSecurityEvent } from "../log-security-event.ts";
import { emailField, safeValidate } from "../validation.ts";
import {
  allowedEmailDomains,
  describeDomains,
  isOnAllowedDomain,
  toDomainList,
  type DomainRule,
} from "./login.ts";

/** Matches `public.user_role` (`supabase/migrations/20260722103000_create_users.sql`). */
export type InviteRole = "cam" | "admin" | "viewer";

/** How each role reads in "...has invited you to join 180Connect as {phrase}." — article included. */
const ROLE_EMAIL_PHRASE: Record<InviteRole, string> = {
  cam: "a Client Acquisition Manager",
  admin: "an Administrator",
  viewer: "a Viewer",
};

/** How each role reads in a short admin-facing message (matches the invite form's <select>). */
const ROLE_SHORT_LABEL: Record<InviteRole, string> = {
  cam: "CAM",
  admin: "Admin",
  viewer: "Viewer",
};

export function inviteSchema(rule: DomainRule = allowedEmailDomains()) {
  const domains = toDomainList(rule);
  return z.object({
    email: emailField("Enter a valid email address.").refine(
      (email) => isOnAllowedDomain(email, domains),
      {
        // Not merely a policy: `enforce_allowed_email_domain_on_signup` is a BEFORE
        // INSERT trigger on auth.users, so an address outside the permitted set is
        // refused by Postgres no matter which path creates it. Saying so here turns a
        // P0001 from deep inside Supabase Auth into a field error on the form.
        message: `Use a ${describeDomains(domains)} email address.`,
      },
    ),
    role: z.enum(["cam", "admin", "viewer"]).default("cam"),
  });
}

export type InviteState = {
  /**
   * `warning` is the outcome that only exists because we send the email
   * ourselves: the account was created and the invite is pending, but nothing
   * was delivered. It is not an error — retrying the invite would be refused as
   * a duplicate — and it is not a success either, because somebody is waiting
   * for an email that is not coming.
   */
  status: "idle" | "error" | "success" | "warning";
  message?: string;
  fieldErrors?: { email?: string[] };
};

/**
 * Shown for an email that already has a row in `public.users` — active account
 * or invite already pending, this repo's schema cannot cheaply tell those two
 * apart (see the module doc), and the acceptance criteria only requires the
 * message be specific, not which one it was. Never shown for a deactivated
 * account — see `DEACTIVATED_ACCOUNT_MESSAGE`, checked first.
 */
export const DUPLICATE_INVITE_MESSAGE =
  "This email already has an account or a pending invite.";

/**
 * Shown for an email that belongs to a deactivated account (F014) rather than
 * an active one or a pending invite. Re-inviting would collide with the
 * existing `auth.users` row (`create_deactivate_user_rpc.sql`'s "A DEACTIVATED
 * PERSON WHO REJOINS IS REACTIVATED, NOT RE-INVITED" note) and mint a token
 * for an account GoTrue already considers real, so this steers the admin to
 * the team list's existing Reactivate action instead of attempting the invite.
 */
export const DEACTIVATED_ACCOUNT_MESSAGE =
  "This email belongs to a deactivated account. Reactivate them from the team list instead of sending a new invite.";

/**
 * Shown on a resend when GoTrue refuses to mint a fresh `invite`-type link
 * because the email is already `email_confirmed` — the previous link was
 * opened once (which confirms the email) but the invited person never
 * finished choosing a password. See `mintAndSendInvite`'s `email_exists`
 * branch for the mechanics.
 */
export const INVITE_ALREADY_OPENED_MESSAGE =
  "This invite link was already opened once but never completed. Cancel this invite, then send a new one.";

/**
 * Shown on `/reset-password` for an expired or already-used invite link (F009
 * AC4). Deliberately not `RESET_LINK_ERROR` (`password-reset.ts`): that message
 * says "Request a new link", which is self-service password recovery — an
 * invited person has no way to send themselves a new invite, only an admin can
 * (F252), so pointing them at `/forgot-password` would be a dead end dressed up
 * as help.
 */
export const INVITE_LINK_ERROR =
  "This invite link has expired or has already been used. Contact your administrator for a new invite.";

/**
 * Looks up an existing `public.users` row by email, or returns `null`.
 * `deactivatedAt` is carried along so `sendInvite` can tell a deactivated
 * account apart from an active one or a pending invite, and steer the admin
 * to reactivation instead of a blocked, unexplained "duplicate" refusal.
 *
 * A plain function rather than a slice of the Supabase client's method chain:
 * the real query builder is a thenable, not a `Promise`, and structurally
 * matching its chained `.from().select().eq().maybeSingle()` shape is more
 * trouble than it is worth (TypeScript rejects it as an excessively deep
 * instantiation). The caller wraps whichever Supabase client it holds; the fake
 * in `invite.test.ts` is just a function.
 */
export type LookupExistingUser = (
  email: string,
) => Promise<{ id: string; deactivatedAt: string | null } | null>;

/**
 * Minimal slice of the Supabase Admin API this module needs to mint the invite.
 *
 * `generateLink` rather than `inviteUserByEmail`: it creates the auth user and
 * returns the token without sending anything, which is what leaves the email to
 * us. See the module doc.
 */
export type InviteAdminClient = {
  auth: {
    admin: {
      generateLink: (params: {
        type: "invite";
        email: string;
        options?: { redirectTo?: string; data?: Record<string, unknown> };
      }) => Promise<{
        data: {
          properties?: { hashed_token?: string } | null;
          user?: { id: string } | null;
        } | null;
        // `code` is GoTrue's stable error token (e.g. `email_exists`) — see the
        // `email_exists` handling in `mintAndSendInvite` for why it matters.
        error: { message: string; code?: string } | null;
      }>;
      /** Cancelling an invite deletes the not-yet-accepted account outright — see `cancelInvite`. */
      deleteUser: (userId: string) => Promise<{ error: { message: string } | null }>;
    };
  };
};

/** The send step, injectable so the tests need no network. */
export type InviteSender = (message: {
  to: string;
  subject: string;
  text: string;
  html: string;
}) => Promise<{ status: "sent" | "skipped" | "failed"; reason?: string }>;

export type SendInviteInput = { email: unknown; role?: unknown };

/** Optional collaborators. Defaults are the real ones. */
export type SendInviteDeps = {
  /** Named in the email so the invitation comes from a person, not the platform. */
  inviterName?: string;
  send?: InviteSender;
  /**
   * Applies a non-`cam` role to a freshly-minted invite (via `public.set_user_role`,
   * the same RPC the in-place role editor uses). Only called by `sendInvite`, and
   * only when a role other than the default is requested — `resendInvite` never
   * touches role, the row already has one.
   */
  setUserRole?: (
    userId: string,
    role: InviteRole,
  ) => Promise<{ error: { message: string } | null }>;
};

export type SendInviteOutcome =
  | { ok: true; state: InviteState }
  | { ok: false; state: InviteState };

/**
 * Validates the email, checks nobody already holds it, and — only if both pass —
 * asks Supabase Auth to mint a single-use invite token, then emails it. Supabase
 * is the token authority here rather than a hand-rolled one: it already
 * generates, stores and expires it, and the link carries the same
 * `token_hash` shape `docs/auth/recovery-email.md` uses for password reset, so
 * it lands on `/auth/confirm` and works in whichever browser opens it.
 *
 * Never throws: a lookup or send failure comes back as a state the caller can
 * render, matching `attemptLogin`'s contract.
 */
export async function sendInvite(
  lookupExistingUser: LookupExistingUser,
  adminClient: InviteAdminClient,
  invitedByUserId: string,
  input: SendInviteInput,
  redirectTo: string,
  rule: DomainRule = allowedEmailDomains(),
  deps: SendInviteDeps = {},
): Promise<SendInviteOutcome> {
  const result = safeValidate(inviteSchema(rule), { email: input.email, role: input.role });

  if (!result.success) {
    logSecurityEvent("validation.rejected", {
      form: "invite",
      fields: Object.keys(result.fieldErrors).join(","),
    });
    return {
      ok: false,
      state: {
        status: "error",
        message: "Check the highlighted field and try again.",
        fieldErrors: result.fieldErrors,
      },
    };
  }

  const { email, role } = result.data;

  let existing: { id: string; deactivatedAt: string | null } | null;
  try {
    existing = await lookupExistingUser(email);
  } catch (error) {
    logSecurityEvent("user.invite_failed", {
      cause: error instanceof Error ? error.message : "lookup failed",
    });
    return {
      ok: false,
      state: { status: "error", message: "Could not check this email. Try again." },
    };
  }

  if (existing?.deactivatedAt) {
    logSecurityEvent("user.invite_rejected", { reason: "deactivated_account" });
    return {
      ok: false,
      state: {
        status: "error",
        message: DEACTIVATED_ACCOUNT_MESSAGE,
        fieldErrors: { email: [DEACTIVATED_ACCOUNT_MESSAGE] },
      },
    };
  }

  if (existing) {
    logSecurityEvent("user.invite_rejected", { reason: "duplicate" });
    return {
      ok: false,
      state: {
        status: "error",
        message: DUPLICATE_INVITE_MESSAGE,
        fieldErrors: { email: [DUPLICATE_INVITE_MESSAGE] },
      },
    };
  }

  // Only `sendInvite` ever applies a role — a fresh account starts as `cam` (the
  // trigger's default), so anything else needs the RPC. Wrapped rather than
  // passed as `deps.setUserRole` directly so a role change requested with no
  // `setUserRole` dep configured still surfaces as a warning instead of
  // silently staying `cam`.
  const applyRole =
    role === "cam"
      ? undefined
      : async (userId: string) => {
          if (!deps.setUserRole) {
            return { error: { message: "setUserRole not configured" } };
          }
          return deps.setUserRole(userId, role);
        };

  return mintAndSendInvite(
    adminClient,
    invitedByUserId,
    email,
    role,
    redirectTo,
    deps,
    {
      successEvent: "user.invited",
      successMessage: `Invite sent to ${email}.`,
      mintFailureMessage: "Could not send the invite. Try again.",
    },
    applyRole,
  );
}

/**
 * The shared tail of `sendInvite` and `resendInvite` (F252): mint a token via
 * `generateLink` and email it. Both callers reach here only after their own
 * validation — email format and domain, no existing account, or (for a resend)
 * a real pending invite to target — so this never re-checks any of that.
 *
 * Never returns `ok: false` past the mint step: once `generateLink` succeeds
 * the account exists (or, for a resend, still does) and the invite is pending
 * either way, so a delivery failure is a `warning`, not an `error` — the admin
 * needs to know the mail did not go out, but retrying `sendInvite` would now be
 * refused as a duplicate, and retrying `resendInvite` is exactly the right fix
 * and must stay available.
 */
async function mintAndSendInvite(
  adminClient: InviteAdminClient,
  invitedByUserId: string,
  email: string,
  role: InviteRole,
  redirectTo: string,
  deps: SendInviteDeps,
  outcome: { successEvent: "user.invited" | "user.invite_resent"; successMessage: string; mintFailureMessage: string },
  /** Only `sendInvite` passes this — see its call site. */
  applyRole?: (userId: string) => Promise<{ error: { message: string } | null }>,
): Promise<SendInviteOutcome> {
  let tokenHash: string;
  let mintedUserId: string | undefined;
  try {
    const { data, error } = await adminClient.auth.admin.generateLink({
      type: "invite",
      email,
      // `data` lands in raw_user_meta_data, which is the only channel
      // app.handle_new_auth_user has for learning who did the inviting — it
      // fires on the auth.users insert, not on this request. A resend passes
      // the same `invitedByUserId` again rather than the original inviter's,
      // which is a deliberate simplification: the row already carries
      // `invited_by_user_id` from the first send, and `handle_new_auth_user`
      // only ever writes it `on conflict (id) do nothing` — this call cannot
      // overwrite it. Passed anyway so the metadata reflects who most recently
      // acted on the invite, if that ever needs to be read.
      options: { redirectTo, data: { invited_by_user_id: invitedByUserId } },
    });

    if (error) {
      // GoTrue refuses to mint an `invite`-type link for an email it already
      // considers confirmed — which happens whenever the previous link was
      // opened (consuming the token, which sets `email_confirmed_at`) but the
      // invited person never finished choosing a password. Our own "pending"
      // definition (`invite_accepted_at is null`) doesn't track that, so this
      // is the one place the mismatch surfaces. `INVITE_CANCEL_NOT_FOUND_MESSAGE`-
      // adjacent, not a generic failure: retrying does nothing, the fix is to
      // cancel the stuck invite and send a fresh one (a new `auth.users` row
      // starts unconfirmed again).
      if (error.code === "email_exists") {
        logSecurityEvent("user.invite_rejected", { reason: "email_exists" });
        return { ok: false, state: { status: "error", message: INVITE_ALREADY_OPENED_MESSAGE } };
      }
      throw new Error(error.message);
    }
    if (!data?.properties?.hashed_token) {
      throw new Error("generateLink returned no token");
    }
    tokenHash = data.properties.hashed_token;
    mintedUserId = data.user?.id;
  } catch (error) {
    logSecurityEvent("user.invite_failed", {
      cause: error instanceof Error ? error.message : "invite creation failed",
    });
    return {
      ok: false,
      state: { status: "error", message: outcome.mintFailureMessage },
    };
  }

  // Applied before the email is composed, so a role warning never contradicts
  // what the email is about to say. A failure here does not fail the invite —
  // the account already exists (same rule a delivery failure follows below).
  let roleWarning: string | undefined;
  if (applyRole) {
    const target = mintedUserId;
    const { error: roleError } = target
      ? await applyRole(target)
      : { error: { message: "generateLink returned no user id" } };
    if (roleError) {
      logSecurityEvent("user.invite_role_failed", { cause: roleError.message });
      roleWarning = `the role could not be set to ${ROLE_SHORT_LABEL[role]} — set it manually from the team list.`;
    }
  }

  // A fresh call to generateLink is what makes the previous link stop working
  // (F252 AC2/AC3): GoTrue stores one confirmation token per pending user, so
  // minting a new one overwrites it — the old token no longer matches anything
  // verifyOtp can find. Nothing in this repo invalidates it; Supabase does,
  // the same way a second password-reset request invalidates the first.
  const link = `${redirectTo}?token_hash=${encodeURIComponent(tokenHash)}&type=invite`;
  const { subject, text, html } = inviteEmail({
    link,
    inviterName: deps.inviterName ?? "An admin",
    role,
  });

  const delivery = await (deps.send ?? sendEmail)({ to: email, subject, text, html });

  if (delivery.status !== "sent") {
    logSecurityEvent("user.invite_failed", {
      cause: "delivery",
      delivery: delivery.status,
    });
    return {
      ok: true,
      state: {
        status: "warning",
        message:
          `${email} was invited, but the email was not sent — they will not have received a link. ` +
          (delivery.reason ?? "") +
          (roleWarning ? ` Also, ${roleWarning}` : ""),
      },
    };
  }

  if (roleWarning) {
    return {
      ok: true,
      state: { status: "warning", message: `${outcome.successMessage} But ${roleWarning}` },
    };
  }

  logSecurityEvent(outcome.successEvent, {});
  return {
    ok: true,
    state: { status: "success", message: outcome.successMessage },
  };
}

/**
 * Looks up a `public.users` row by id for a resend, returning whether the
 * invite it carries has already been accepted — or `null` if the row does not
 * exist at all. A plain function for the same reason `LookupExistingUser` is:
 * the real query builder is not structurally a `Promise` (see that type's doc).
 */
export type LookupPendingInvite = (
  userId: string,
) => Promise<{ email: string; accepted: boolean; role: InviteRole } | null>;

/** Shown when a resend is attempted for an id that no longer has a row. */
export const INVITE_NOT_FOUND_MESSAGE = "This invite could not be found.";

/**
 * Shown when a resend is attempted for an invite that was accepted between the
 * admin's page loading and the click — F252 AC4 enforced here, not only by the
 * pending-invites list already excluding accepted rows. The list filter is the
 * common case; this is what makes it correct under a race, not decorative.
 */
export const INVITE_ALREADY_ACCEPTED_MESSAGE = "This invite has already been accepted.";

/**
 * Re-sends an invite for an existing pending row (F252). Deliberately not
 * `sendInvite` called again: that function's duplicate check exists to refuse
 * exactly this case (a `public.users` row already present for the email), so a
 * resend needs its own path that starts from "this row must already exist and
 * still be pending" rather than "this email must not exist yet".
 *
 * Takes a user id, not an email: the caller only ever has one from a row
 * already rendered in the admin's pending-invites list, and looking the email
 * up here — rather than trusting one passed in — means the address actually
 * mailed is always the one the database has, never whatever a client sent.
 *
 * Never throws, same contract as `sendInvite`.
 */
export async function resendInvite(
  lookupPendingInvite: LookupPendingInvite,
  adminClient: InviteAdminClient,
  invitedByUserId: string,
  userId: string,
  redirectTo: string,
  deps: SendInviteDeps = {},
): Promise<SendInviteOutcome> {
  let invite: { email: string; accepted: boolean; role: InviteRole } | null;
  try {
    invite = await lookupPendingInvite(userId);
  } catch (error) {
    logSecurityEvent("user.invite_failed", {
      cause: error instanceof Error ? error.message : "lookup failed",
      action: "resend",
    });
    return {
      ok: false,
      state: { status: "error", message: "Could not check this invite. Try again." },
    };
  }

  if (!invite) {
    logSecurityEvent("user.invite_rejected", { reason: "not_found", action: "resend" });
    return { ok: false, state: { status: "error", message: INVITE_NOT_FOUND_MESSAGE } };
  }

  if (invite.accepted) {
    logSecurityEvent("user.invite_rejected", { reason: "already_accepted", action: "resend" });
    return { ok: false, state: { status: "error", message: INVITE_ALREADY_ACCEPTED_MESSAGE } };
  }

  // Role never changes on a resend — the row already carries the one it was
  // invited with, so this only threads it through for the email copy, never
  // an `applyRole` callback (that's `sendInvite`-only, see its call site).
  return mintAndSendInvite(
    adminClient,
    invitedByUserId,
    invite.email,
    invite.role,
    redirectTo,
    deps,
    {
      successEvent: "user.invite_resent",
      successMessage: `A new invite was sent to ${invite.email}.`,
      mintFailureMessage: "Could not resend the invite. Try again.",
    },
  );
}

/** Shown when a cancel is attempted for an id that no longer has a row. */
export const INVITE_CANCEL_NOT_FOUND_MESSAGE = "This invite could not be found.";

/**
 * Shown when a cancel is attempted for an invite that was accepted between the
 * admin's page loading and the click — the row is now a real team member, and
 * pulling their account out from under them is a different operation (offboarding),
 * not a cancelled invite.
 */
export const INVITE_CANCEL_ALREADY_ACCEPTED_MESSAGE =
  "This is now a team member — use the team list to deactivate them instead.";

/** The one call `cancelInvite` needs to record a cancellation, kept minimal so tests can fake it. */
export type AuditLogWriter = {
  from: (table: string) => {
    insert: (row: Record<string, unknown>) => PromiseLike<{ error: unknown }>;
  };
};

/**
 * Cancels a pending invite (rescinds it before it's accepted) by deleting the
 * not-yet-accepted account outright.
 *
 * There is no `invites` table and no `status`/`revoked_at` column to flip —
 * invite state lives entirely on `public.users` (`invited_at`,
 * `invite_accepted_at`), and adding one would mean editing the Data Model
 * spreadsheet first (schema truth, AGENTS.md), not something this feature
 * needs. `public.users.id` references `auth.users.id` `on delete cascade`
 * (`create_users.sql`), so deleting the auth user removes the app-side row in
 * the same step — no orphan, no soft-delete flag to invent. It's also fully
 * reversible from the admin's side: the email is free again immediately, so
 * re-inviting it is one click.
 *
 * Never throws, same contract as `sendInvite`/`resendInvite`.
 */
export async function cancelInvite(
  lookupPendingInvite: LookupPendingInvite,
  adminClient: InviteAdminClient,
  writeAuditLog: AuditLogWriter,
  actorId: string,
  userId: string,
): Promise<SendInviteOutcome> {
  let invite: { email: string; accepted: boolean; role: InviteRole } | null;
  try {
    invite = await lookupPendingInvite(userId);
  } catch (error) {
    logSecurityEvent("user.invite_failed", {
      cause: error instanceof Error ? error.message : "lookup failed",
      action: "cancel",
    });
    return {
      ok: false,
      state: { status: "error", message: "Could not check this invite. Try again." },
    };
  }

  if (!invite) {
    logSecurityEvent("user.invite_rejected", { reason: "not_found", action: "cancel" });
    return { ok: false, state: { status: "error", message: INVITE_CANCEL_NOT_FOUND_MESSAGE } };
  }

  if (invite.accepted) {
    logSecurityEvent("user.invite_rejected", { reason: "already_accepted", action: "cancel" });
    return {
      ok: false,
      state: { status: "error", message: INVITE_CANCEL_ALREADY_ACCEPTED_MESSAGE },
    };
  }

  const { error } = await adminClient.auth.admin.deleteUser(userId);
  if (error) {
    logSecurityEvent("user.invite_failed", { cause: error.message, action: "cancel" });
    return {
      ok: false,
      state: { status: "error", message: "Could not cancel the invite. Try again." },
    };
  }

  // The account is already gone at this point — an audit-log failure is logged
  // but does not turn the cancellation into an error; there's nothing left to retry.
  const { error: auditError } = await writeAuditLog.from("audit_log").insert({
    actor_user_id: actorId,
    action: "invite_cancelled",
    target_table: "users",
    target_id: userId,
    detail: { email: invite.email },
  });
  if (auditError) {
    logSecurityEvent("user.invite_cancel_audit_failed", {
      cause: auditError instanceof Error ? auditError.message : String(auditError),
    });
  }

  logSecurityEvent("user.invite_cancelled", {});
  return {
    ok: true,
    state: { status: "success", message: `Invite to ${invite.email} was cancelled.` },
  };
}

/**
 * How long an invite link is good for, in hours, as configured in Supabase Auth
 * (Authentication → Providers → Email → invite expiry). Used only to say so in
 * the email — Supabase is what enforces it. Keep the two aligned (F010).
 */
export const INVITE_EXPIRY_HOURS = 24;

/**
 * The message an invited person receives.
 *
 * The markup is the template that used to live in the Supabase dashboard —
 * moved here verbatim when sending moved into this repo, so it is now version
 * controlled rather than a field a project reset can silently lose. Tables and
 * inline styles are deliberate, and so is `&amp;` over a bare `&`: see the
 * template note in `docs/auth/recovery-email.md` for which email clients
 * require what. The only substantive change is that `{{ .Email }}` became the
 * inviter's name — Resend does not interpolate Supabase's template variables,
 * and naming the colleague who invited you reads better than naming your own
 * address back at you.
 *
 * Plain text is the body that must always work; the HTML is the same words with
 * a button. The link is written out in full in both, because an emailed button
 * that cannot be copied is useless on a device that opens mail in one app and
 * browses in another.
 */
export function inviteEmail(input: {
  link: string;
  inviterName: string;
  role: InviteRole;
  expiryHours?: number;
}): { subject: string; text: string; html: string } {
  const { link, inviterName, role } = input;
  const expiryHours = input.expiryHours ?? INVITE_EXPIRY_HOURS;
  const safeLink = escapeHtml(link);
  const safeInviter = escapeHtml(inviterName);
  const rolePhrase = ROLE_EMAIL_PHRASE[role];

  const subject = "You're invited to 180Connect";

  const text = [
    "Hi,",
    "",
    `${inviterName} has invited you to join 180Connect as ${rolePhrase}.`,
    "",
    "Choose a password to finish setting up your account:",
    link,
    "",
    `This link expires in ${expiryHours} hours and can only be used once. If it has expired, ask ${inviterName} to send you a new one.`,
    "",
    "If you weren't expecting this, you can ignore this email — no account will be created.",
  ].join("\n");

  const html = `
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f1f2f4;margin:0;padding:32px 12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <tr>
    <td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;background-color:#ffffff;border-radius:16px;padding:40px 32px;">
        <tr>
          <td style="font-size:14px;font-weight:bold;color:#72b744;padding-bottom:12px;">180Connect</td>
        </tr>
        <tr>
          <td style="font-size:24px;font-weight:bold;color:#1a1a1a;padding-bottom:12px;">You're invited to 180Connect</td>
        </tr>
        <tr>
          <td style="font-size:14px;line-height:22px;color:#5c5c5c;padding-bottom:28px;">
            <strong style="color:#1a1a1a;">${safeInviter}</strong> has invited you to join 180Connect as ${rolePhrase}. Choose a password to finish setting up your account.
          </td>
        </tr>
        <tr>
          <td align="center" style="padding-bottom:28px;">
            <a href="${safeLink}"
               style="display:inline-block;background-color:#72b744;color:#ffffff;font-size:14px;font-weight:bold;text-decoration:none;padding:13px 32px;border-radius:999px;">
              Accept invite
            </a>
          </td>
        </tr>
        <tr>
          <td style="font-size:13px;line-height:20px;color:#5c5c5c;padding-bottom:20px;">
            This link expires in ${expiryHours} hours and can only be used once.
          </td>
        </tr>
        <tr>
          <td style="font-size:13px;line-height:20px;color:#5c5c5c;padding-bottom:24px;">
            If you weren't expecting this, you can ignore this email — no account will be created.
          </td>
        </tr>
        <tr>
          <td style="border-top:1px solid #e8e8e8;padding-top:20px;font-size:12px;line-height:18px;color:#8a8a8a;">
            If the button doesn't work, copy and paste this link into your browser:<br />
            <span style="color:#72b744;word-break:break-all;">${safeLink}</span>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>`.trim();

  return { subject, text, html };
}

/** Escapes text interpolated into the HTML body. The inviter's name is user data. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
