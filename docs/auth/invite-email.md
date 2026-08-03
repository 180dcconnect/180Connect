# Invite New CAM email (F008)

Same reasoning as [Password recovery email](recovery-email.md): the Supabase
**Invite user** email template is dashboard configuration, not version
controlled, and a project reset or a second environment set up from scratch
loses it silently. This file is the source of truth for it.

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
