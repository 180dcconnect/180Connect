# Invite New CAM email (F008)

> **This email no longer comes from Supabase.** It is composed by
> `inviteEmail()` in `src/lib/auth/invite.ts` and sent through Resend by
> `src/lib/email/send.ts` — see [email-sending.md](../email-sending.md). The
> template below is not dashboard configuration any more; it is the markup in
> that function, kept here for review. There is nothing to paste into
> Authentication → Email Templates → **Invite user**, and anything already there
> is dead: `generateLink` does not send it.
>
> Password recovery is unchanged and still uses the dashboard template — see
> [recovery-email.md](recovery-email.md).

## Supabase configuration

Authentication → URL Configuration. Still required: `generateLink` refuses a
`redirectTo` that is not on the allow-list, so an invite link is not issued at
all if this is wrong. Same list `recovery-email.md` requires, since invites land
on the same `/auth/confirm` route:

| Setting | Value |
| :------ | :---- |
| Site URL | `https://180connect.vercel.app` |
| Redirect URLs | `https://180connect.vercel.app/auth/confirm`, `http://localhost:3000/auth/confirm` |

Authentication → Providers → Email → invite expiry is what actually expires the
link. `INVITE_EXPIRY_HOURS` in `src/lib/auth/invite.ts` only *says* how long it
lasts; keep the two aligned or the email lies (F010).

## The template

The markup below lives in `inviteEmail()`. Two differences from the dashboard
version it replaced, both forced by the move: `{{ .TokenHash }}` is interpolated
in TypeScript rather than by Supabase, and `{{ .Email }}` became the inviter's
name — Resend does not expand Supabase's template variables, and naming the
colleague who invited you reads better than naming your own address back at you.

Uses `{{ .TokenHash }}` against `/auth/confirm?token_hash=...&type=invite`, for
the same reason recovery does: the alternative, `{{ .ConfirmationURL }}`,
issues a PKCE code that only works in the browser that requested it, which
fails for an invite link opened in a mail app rather than the browser the
admin sent it from.

Tables and inline styles, and `&amp;` rather than a bare `&`, are deliberate —
see `recovery-email.md`'s template note; the same email-client constraints
apply here.

```html
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
            An administrator has invited <strong style="color:#1a1a1a;">{{ .Email }}</strong> to join 180Connect as a Client Acquisition Manager. Choose a password to finish setting up your account.
          </td>
        </tr>
        <tr>
          <td align="center" style="padding-bottom:28px;">
            <a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&amp;type=invite"
               style="display:inline-block;background-color:#72b744;color:#ffffff;font-size:14px;font-weight:bold;text-decoration:none;padding:13px 32px;border-radius:999px;">
              Accept invite
            </a>
          </td>
        </tr>
        <tr>
          <td style="font-size:13px;line-height:20px;color:#5c5c5c;padding-bottom:20px;">
            This link can only be used once.
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
            <span style="color:#72b744;word-break:break-all;">{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&amp;type=invite</span>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
```

## Sending

Through Resend, from `EMAIL_FROM`, not through Supabase's shared mailer. That
mailer's few-messages-per-hour project-wide limit no longer applies to invites —
only to password recovery, which still uses it.

Unlike the reset form, the invite Server Action does **not** hide failures
behind a neutral message: the admin is not an anonymous caller probing for
account existence, so `src/lib/auth/invite.ts` reports plainly.

There are two distinct failures, and they are reported differently because the
admin has to do different things about them:

| What failed | State | What the admin sees | What to do |
| :--- | :--- | :--- | :--- |
| `generateLink` — no account was created | `error` | "Could not send the invite. Try again." | Retry the invite |
| The send — the account **was** created, the invite is pending, no email went out | `warning` | "… was invited, but the email was not sent" | Do **not** retry (it will be refused as a duplicate). Reissue the link (F252), or fix `RESEND_API_KEY`/`EMAIL_FROM` |

The second row is the outcome that did not exist while Supabase sent the mail:
`inviteUserByEmail` returned success as soon as Supabase accepted the request,
so an invite that never arrived was indistinguishable from one that did.

Locally, with no `RESEND_API_KEY` set, every invite lands in the `warning` state
and the message body is written to the dev-server console. That is the intended
local experience — copy the link out of the log.

## Who can be invited, and how to widen it for testing

Invites can only be issued to a permitted domain, and the enforcement is in
Postgres — `enforce_allowed_email_domain_on_signup`, a BEFORE INSERT trigger on
`auth.users` reading `app.allowed_email_domains` (20260804160000). It fires on
every path: the admin API, the auth hook, raw SQL. There is no way around it
from the application.

**Production holds `180dc.org` alone, and stays that way by default.** Nothing
has to be switched off at the end of the project — production is only ever
widened by someone deliberately inserting a row into it.

### Try plus-addressing first

`bashir+ben@180dc.org`, `bashir+mo@180dc.org` and so on are distinct accounts to
Supabase, pass the domain check unchanged, and all deliver to the one real
mailbox. That is usually enough to test the flow with several users and needs no
configuration at all. It depends on the mail host supporting `+`, which Google
Workspace does — send yourself one before relying on it.

Where it is not enough: when someone else needs to click *their own* link on
*their own* device. Aliases all land with you.

### Permitting another domain on staging

Two steps, because there are two layers. Do both, or the symptom is confusing.

```sql
-- 1. The enforcement. Against the staging project only.
insert into app.allowed_email_domains (domain, note)
values ('gmail.com', 'F008 testing while HQ arranges 180dc.org mailboxes — remove after');
```

```bash
# 2. The form's own validation, so it stops refusing what the database allows.
vercel env rm  AUTH_ALLOWED_EMAIL_DOMAIN preview
vercel env add AUTH_ALLOWED_EMAIL_DOMAIN preview   # 180dc.org,gmail.com
```

Then redeploy the preview. Miss step 2 and the invite form rejects the address
before it reaches the database; miss step 1 and the form accepts it and Postgres
refuses with `email_domain_not_allowed`.

`EMAIL_RECIPIENT_ALLOWLIST` is a third, separate thing — it decides who
`sendEmail` will deliver to. A domain permitted to hold an account but missing
from that list produces an invite in the `warning` state.

### Removing it again

```sql
delete from app.allowed_email_domains where domain = 'gmail.com';
```

Existing accounts on that domain keep working — the trigger governs new inserts
only. Deactivate them through the admin UI if they should not survive the test.
Emptying the table entirely disables sign-up completely rather than opening it
up; the guard fails closed, and there is a pgTAP test asserting exactly that.

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
