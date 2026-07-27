# Password recovery email (F004)

The reset flow depends on one piece of configuration that does not live in this
repo: the Supabase **Reset Password** email template. This file is the source of
truth for it, because a dashboard is not version controlled — a project reset,
a restored backup, or a second environment set up from scratch all lose it
silently, and the failure shows up as a reset link that does not work rather
than as an error.

## Supabase configuration

Authentication → URL Configuration:

| Setting | Value |
| :------ | :---- |
| Site URL | `https://180connect.vercel.app` |
| Redirect URLs | `https://180connect.vercel.app/auth/recovery`, `https://180connect.vercel.app/auth/confirm`, `http://localhost:3000/auth/recovery` |

Add `https://*.vercel.app/auth/recovery` as well if reset needs to work on
preview deployments.

These must be **full URLs**. A bare path is rejected with "Please provide a
valid URL".

Use `https://`, never `http://`. In production the recovery marker cookie is
set with `Secure`, so a browser will not send it back over plain http and the
reset fails at the final step with the generic expired-link message.

Authentication → Providers → Email: leave the recovery OTP expiry at **3600
seconds**, matching `PASSWORD_RESET_WINDOW_SECONDS` (see
[environment-variables.md](../environment-variables.md)). The template below
says "one hour" in prose; change both together or neither.

`SESSION_ACTIVITY_SECRET` must be set in every hosted environment. The recovery
marker is HMAC-signed with it, and production refuses an unsigned marker rather
than trust one any session holder could forge — so without it, password reset
stops working entirely.

## The template

Authentication → Email Templates → **Reset Password**.

Note this uses `{{ .TokenHash }}` against `/auth/confirm` rather than the
default `{{ .ConfirmationURL }}`. `ConfirmationURL` issues a PKCE code that can
only be exchanged by the browser that requested the reset, so a link opened on
a phone — the common case, since people read email on their phone — fails as an
invalid link. The token-hash form carries no browser-bound state and works
anywhere.

Tables and inline styles are deliberate: Gmail and Outlook strip `<style>`
blocks and do not support flexbox or grid. `&amp;` rather than a bare `&` is
also deliberate — some clients mangle an unescaped ampersand and truncate the
query string, which silently drops `type=recovery`.

```html
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f1f2f4;margin:0;padding:32px 12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <tr>
    <td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;background-color:#ffffff;border-radius:16px;padding:40px 32px;">
        <tr>
          <td style="font-size:14px;font-weight:bold;color:#72b744;padding-bottom:12px;">180Connect</td>
        </tr>
        <tr>
          <td style="font-size:24px;font-weight:bold;color:#1a1a1a;padding-bottom:12px;">Reset your password</td>
        </tr>
        <tr>
          <td style="font-size:14px;line-height:22px;color:#5c5c5c;padding-bottom:28px;">
            We received a request to reset the password for <strong style="color:#1a1a1a;">{{ .Email }}</strong>. Choose a new one using the button below.
          </td>
        </tr>
        <tr>
          <td align="center" style="padding-bottom:28px;">
            <a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&amp;type=recovery"
               style="display:inline-block;background-color:#72b744;color:#ffffff;font-size:14px;font-weight:bold;text-decoration:none;padding:13px 32px;border-radius:999px;">
              Choose a new password
            </a>
          </td>
        </tr>
        <tr>
          <td style="font-size:13px;line-height:20px;color:#5c5c5c;padding-bottom:20px;">
            This link expires in one hour and can only be used once.
          </td>
        </tr>
        <tr>
          <td style="font-size:13px;line-height:20px;color:#5c5c5c;padding-bottom:24px;">
            If you didn't ask to reset your password, you can ignore this email — your password will not change.
          </td>
        </tr>
        <tr>
          <td style="border-top:1px solid #e8e8e8;padding-top:20px;font-size:12px;line-height:18px;color:#8a8a8a;">
            If the button doesn't work, copy and paste this link into your browser:<br />
            <span style="color:#72b744;word-break:break-all;">{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&amp;type=recovery</span>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
```

The brand green is `#72b744`, matching `--brand` in `src/app/globals.css`.

## Sending

Supabase's built-in email service sends these without any SMTP configuration,
but it is a shared development service: the send rate is a handful of messages
per hour **for the whole project**, and the template cannot be customised until
custom SMTP is configured.

That rate limit is easy to misread. The reset form deliberately shows the same
"if an account exists, we've sent instructions" message whether or not the send
succeeded, so that it cannot be used to discover who has an account. A
rate-limited send therefore looks identical to a successful one from the
browser. The failure is recorded — look for `API_HEALTH_LOGS` with
`operation: "password-reset-request"` and `ok: false`, and the matching
`authentication.password_reset_request_failed` entry.

To lift the limit and enable this template, point Supabase at a real provider
(Resend, Postmark, SES) under Project Settings → Authentication → SMTP.

Doing that needs a domain whose DNS you control, so the provider can verify SPF
and DKIM. `180connect.vercel.app` cannot be used — Vercel owns `vercel.app`, so
its DNS records are not ours to set. The options are a subdomain of `180dc.org`
delegated for sending (`connect.180dc.org` or similar), which has the side
benefit that reset mail arrives from the same domain recipients already trust,
or a separately purchased domain.
