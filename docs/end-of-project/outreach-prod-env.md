# Outreach environment — production is not wired

Found while checking whether inbox send / schedule actually work, 9 September 2026.

## Gmail + cron secrets are missing from the Production Vercel scope

**What is wrong.** `vercel env ls` shows all five outreach secrets on the
**Preview** scope (which is what `dev` / staging deploys use) and **none** on
**Production**:

| Variable | Preview | Production |
| --- | --- | --- |
| `GMAIL_CLIENT_ID` | set | — |
| `GMAIL_CLIENT_SECRET` | set | — |
| `GMAIL_REFRESH_TOKEN` | set | — |
| `GMAIL_SENDER_EMAIL` | set (`clients.sheffield@180dc.org`) | — |
| `CRON_SECRET` | set | — |

Consequences on `main` / the production deployment:

- Every send returns `"Gmail is not configured."` — `resolveGmailConfig`
  returns `null` when any of the three OAuth values is absent
  (`src/lib/gmail/client.ts:103`). The four `GMAIL_*` names are also
  all-or-nothing at startup (`src/lib/env.ts:361`): setting one without the
  rest makes the server refuse to boot.
- Scheduled sends never deliver. The pg_cron job
  (`supabase/migrations/20260902120100_schedule_scheduled_outreach_cron.sql`)
  POSTs `/api/cron/scheduled-outreach` with `Authorization: Bearer
  $CRON_SECRET`; with no secret set the route 401s every run
  (`src/app/api/cron/scheduled-outreach/route.ts:25`) and rows sit in
  `scheduled` forever.

**Why it was deferred.** `main` only receives weekly merges from `dev` (PM
decision), and outreach has been exercised on staging only — the free-plan
production project is not in active client use yet. Wiring live Gmail
credentials into an environment nobody is watching invites an unattended real
send before anyone means to go live.

**What to do.**

1. Set on the **Production** scope — Vercel dashboard → `180connect` →
   Settings → Environment Variables (tick Production), or
   `vercel env add <NAME> production`:
   `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`,
   `GMAIL_SENDER_EMAIL` (`clients.sheffield@180dc.org`), `CRON_SECRET`.

   Values: either copy the Preview values, or regenerate in the F241 Google
   Cloud project — new OAuth client for `GMAIL_CLIENT_ID` / `GMAIL_CLIENT_SECRET`,
   and a fresh `GMAIL_REFRESH_TOKEN` from an OAuth consent as
   `clients.sheffield@180dc.org` with scopes `gmail.send` + `gmail.readonly`
   (readonly is for reply-sync). `CRON_SECRET`: `openssl rand -hex 32`.

2. Redeploy production.

3. Put the **same** `CRON_SECRET` in the production Supabase project's Vault —
   pg_cron reads it there, and the two must match.

4. Confirm `20260902120100_schedule_scheduled_outreach_cron.sql` is applied to
   the production Supabase project (auto-applies on merge to `main`;
   `supabase migration list --linked` against prod to check).

5. Verify: one test send from prod to an internal address; schedule one ~6 min
   out and watch `outreach_messages.send_status` move `scheduled` → `sent`.

**Who decides.** `DECISION` — PM signs off that production may send live client
outreach before the keys go in.

## Housekeeping: stale per-branch `GMAIL_CLIENT_ID` overrides

`vercel env ls` also lists ~30 branch-scoped `GMAIL_CLIENT_ID` entries on
Preview (`Preview (feature/…)`), all created in one batch 5 days before this
note. They are harmless — the plain Preview value covers every branch — but
they are noise in every `vercel env` listing. Delete them when convenient.
