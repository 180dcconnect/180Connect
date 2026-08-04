# Transactional email sending

**Status:** Reference for `src/lib/email/`
**Last updated:** 4 August 2026

---

## What goes through this, and what does not

Three kinds of email leave 180 Connect. They use three different paths, and
mixing them up is the mistake this document exists to prevent.

| Mail | Path | Verified domain needed? |
|---|---|---|
| **Client outreach** — a CAM emailing a charity contact | Gmail API `users.messages.send` on the CAM's own authorised account (PRD §12.1) | No — it is the CAM's real mailbox |
| **Auth mail** — password reset, email confirmation | Supabase Auth, over SMTP to Resend ([recovery-email.md](auth/recovery-email.md)) | **Yes** |
| **Platform mail** — admin invites, notification digests | `src/lib/email/send.ts` → Resend | **Yes** |

Only the third row is this module. Outreach must never be routed through it:
Gmail is what gives replies a stable thread and message id, which is what the
whole reply-sync and outcome model in PRD §12.3 is built on.

Rows two and three both end at Resend, and both send from the same verified
domain — one provider, one reputation, one set of delivery logs. They are still
two paths, and the difference matters in one specific way:

> **`EMAIL_RECIPIENT_ALLOWLIST` guards this module only.** Auth mail goes
> Supabase → SMTP → Resend and never passes through `sendEmail`, so the
> allowlist cannot stop it. A password reset requested for a seeded address on
> staging **will** be delivered. The allowlist is a guard on the invite path, not
> a blanket block on outbound mail — Supabase's own recipient is always the
> account holder who asked, which is why this is acceptable rather than a hole.

The practical consequence is that **not having DNS access to 180dc.org does not
block outreach**. It blocks invites and notification email, and nothing else.

## The two transports

`sendEmail()` picks a transport from the environment. There is no flag to set:

- **`RESEND_API_KEY` unset → console.** The message is validated, the allowlist
  is applied, and then it is written to the log instead of sent. This is the
  default, so a checkout with no configuration cannot email anybody, and neither
  can CI.
- **`RESEND_API_KEY` set → Resend.** Posted to `https://api.resend.com/emails`
  over plain `fetch`, no SDK — the same approach `error-logging.ts` takes with
  Sentry.

`sendEmail()` never throws. Every outcome is a `SendResult` of `sent`,
`skipped`, or `failed`, because the callers are "invite a user" and "notify the
owning CAM" — neither should fail the action it is reporting on because mail is
down. Read the result if the user needs to be told.

```ts
import { sendEmail } from "@/lib/email/send";

const result = await sendEmail({
  to: user.email,
  subject: "You have been invited to 180 Connect",
  text: `Set your password: ${link}`,
});

if (result.status !== "sent") {
  // The invite row still exists. Offer to resend rather than failing the write.
}
```

## Why `onboarding@resend.dev` is not an option

Resend lets an account with no verified domain send from
`onboarding@resend.dev`. That address **only delivers to the email address of
the Resend account owner**. Any other recipient is refused with a `403`
`validation_error`. It is not a deliverability or spam-score compromise — it is
a hard block, and it makes the address useless for the one thing platform mail
does, which is email somebody other than you.

So sending requires a domain verified in Resend. Any domain the sender controls
will do; it does not have to be 180dc.org.

## Current configuration

180DC HQ has not yet provided DNS access to 180dc.org. Until they do, staging
sends from a domain the project lead already controls and has verified in
Resend. That is a deliberate stopgap with two rules attached:

1. **`EMAIL_RECIPIENT_ALLOWLIST` must be set in every environment using it.**
   A staging database seeded with real-looking charity contacts is one buggy
   query away from emailing a trustee from an unrelated business domain, and the
   allowlist is what makes that impossible rather than unlikely.

   Set it to **`180dc.org`**, plus any specific outside addresses you are
   testing with. Not just your own address: invites can only ever be issued to
   `@180dc.org`, because `enforce_180dc_domain_on_signup` is a BEFORE INSERT
   trigger on `auth.users`. An allowlist that does not cover that domain blocks
   every invite the app is capable of sending, and each one comes back as
   `warning` — account created, nothing delivered.
2. **`EMAIL_FROM` changes and nothing else does** when 180dc.org becomes
   available. Verify the domain in Resend, update the variable, unset the
   allowlist in production. No code change — the sending domain is a deployment
   decision, which is why it lives in the environment. The Supabase SMTP sender
   has to be updated in the same pass; it is a separate field in a separate
   system, and `secrets.md` has the order.

## Setting it up

1. Resend dashboard → **Domains** → add the domain, add the DKIM/SPF records it
   gives you, wait for **Verified**.
2. **API Keys** → create a key with **Sending access** only. It begins `re_`.
3. Set the variables for the environment — locally in `.env.local`, on Vercel
   under Settings → Environment Variables:

   ```
   RESEND_API_KEY=re_...
   EMAIL_FROM=180 Connect <no-reply@your-verified-domain>
   EMAIL_RECIPIENT_ALLOWLIST=180dc.org,your-own@address
   ```

   Startup validation rejects a key with no `EMAIL_FROM`, so a deployment that
   thinks it can send but cannot fails immediately rather than one silent
   refusal at a time.

4. Leave `RESEND_API_KEY` **unset locally** unless you are specifically testing
   delivery. The console transport shows you the full message body without
   spending a send or risking a recipient.

## Who calls it

| Caller | Story | What happens if the send fails |
|---|---|---|
| `sendInvite()` in `src/lib/auth/invite.ts` — admin invites a CAM | F008 | The account exists and the invite is pending, correctly. The outcome comes back as `status: "warning"` and the admin sees it on the team page. The fix is to reissue the link (F252), not to recreate the user — a retry is refused as a duplicate |

The invite path is worth reading as the model for the next caller. Supabase Auth mints
the token, then `sendEmail` delivers it, and only the first step failing aborts the
operation. Email is the least reliable step and the one whose failure is most
recoverable, so it is the one allowed to fail loudly rather than take the whole
operation down with it.

Note `generateLink` rather than `inviteUserByEmail`: the latter sends Supabase's own
email from Supabase's own template, which means our copy, our sender and our record of
delivery all disappear — and it reports success the moment Supabase accepts the
request, so an invite that never arrived looked exactly like one that did.
`generateLink` creates the user and returns a token, and sends nothing.

Full detail in [auth/invite-email.md](auth/invite-email.md).

## Sending limits

PRD §7.9 caps outbound at 100 emails per day across the platform. That cap
governs outreach, not this module, but Resend's own free tier (100/day, 3,000/
month) sits in the same range — worth knowing before a notification digest goes
out to every CAM at once.
