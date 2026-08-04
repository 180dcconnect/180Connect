# Invite New CAM email (F008)

Same reasoning as [Password recovery email](recovery-email.md): the Supabase
**Invite user** email template is dashboard configuration, not version
controlled, and a project reset or a second environment set up from scratch
loses it silently. This file is the source of truth for it.

> **Editing the template on a hosted project now requires custom SMTP.** Supabase
> only allows template edits once your own SMTP server is configured; projects on
> the built-in shared mailer are stuck with the defaults. The default invite
> template does **not** work with this codebase — measured, not assumed: it links
> to `<project>.supabase.co/auth/v1/verify?token=...&type=invite&redirect_to=...`,
> which verifies server-side and returns the session in a URL fragment, while
> `src/app/auth/confirm/route.ts` reads `token_hash` and `type` from the query
> string. GoTrue also drops any `redirect_to` path not listed exactly in the
> redirect allow-list, silently falling back to Site URL, so the link does not
> even reach `/auth/confirm`. **Until staging has custom SMTP, F008 cannot work
> there.** Locally it works without SMTP: the template is applied from
> `supabase/templates/invite.html` via `supabase/config.toml`.

## Supabase configuration

Authentication → URL Configuration — same Redirect URLs list `recovery-email.md`
requires already covers this, since invites land on the same `/auth/confirm`
route:

| Setting | Value |
| :------ | :---- |
| Site URL | `https://180connect.vercel.app` |
| Redirect URLs | `https://180connect.vercel.app/auth/confirm`, `http://localhost:3000/auth/confirm` |

## The template

Authentication → Email Templates → **Invite user**.

Uses `{{ .TokenHash }}` against `/auth/confirm?token_hash=...&type=invite`, for
the same reason recovery does: the alternative, `{{ .ConfirmationURL }}`,
issues a PKCE code that only works in the browser that requested it, which
fails for an invite link opened in a mail app rather than the browser the
admin sent it from.

Tables and inline styles, and `&amp;` rather than a bare `&`, are deliberate —
see `recovery-email.md`'s template note; the same email-client constraints
apply here.

The template itself lives at [`supabase/templates/invite.html`](/supabase/templates/invite.html) — one copy, so the
version this document describes and the version a local stack actually renders
cannot drift apart. Paste that file's contents into the **Invite user** template
in the dashboard.

## Sending

Same shared, rate-limited Supabase mailer described in `recovery-email.md`
applies here — a handful of messages per hour for the whole project, until
custom SMTP is configured. Unlike the reset form, the invite Server Action does
**not** hide send failures behind a neutral message: the admin is not an
anonymous caller probing for account existence, so `src/lib/auth/invite.ts`
reports a send failure plainly (`user.invite_failed`) rather than pretending it
succeeded.

## What happens after the link is clicked

`/auth/confirm?type=invite` verifies the token, opens a Supabase session for
the invited user, and lands them on `/reset-password` — the same "choose a
password" form password recovery uses (see `src/lib/auth/recovery-landing.ts`).
There is no separate accept-invite page: setting a password *is* accepting the
invite, and that is meant literally. `users.invite_accepted_at` is stamped by
`public.mark_invite_accepted()`
(`supabase/migrations/20260804090000_add_user_invite_tracking.sql`), which the
password form's Server Action calls *after* the password update succeeds — not by
a trigger on email confirmation.

The distinction matters. Verifying the invite token confirms the email and opens
a session before any password exists. Had acceptance been stamped there, clicking
the link in a mail app would be enough to clear the invite from the admin's
pending list, and anyone who clicked and then closed the tab would be left holding
an account they cannot log into, with no admin-visible sign of it. Clicking the
link proves someone can read the mailbox; only a set password proves there is a
usable account at the end of it.

So a half-finished invite stays pending, and stays visible to the admin, until
the password is set.
