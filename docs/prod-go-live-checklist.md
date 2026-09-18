# Production go-live checklist

Every step that has to happen **outside the repository** before
`180connect-production` can be used by real CAMs, in the order it has to happen.
Run it top to bottom.

The code half takes care of itself. Merging `dev` → `main` makes Vercel build
production and makes `migrations.yml` apply every migration to the production
database (`apply-prod`, gated on `verify` passing). Nothing on this page can be
done by a merge — it is all per-environment configuration, which is exactly why
none of it lives in a migration and why a missing step leaves the app running
happily with one feature dead.

**Where things are**

| | Staging | Production |
| --- | --- | --- |
| Vercel scope | Preview | **Production** |
| Vercel branch | `dev` | `main` |
| Supabase project | `180connect-staging` (`cgbfhhdeapasniudyyds`) | `180connect-production` (`tugfhwiqvwrpvawpjwmd`) |
| App URL | `https://180connect-git-dev-180connect.vercel.app` | `https://180connect.vercel.app` |

Anything with a row per environment needs doing **twice**, once per scope. This
page is the production column only; staging already has it.

---

## 0. Two things to settle before you start

### 0.1 The decision

**`DECISION` — PM signs off that production may send live client outreach.**
This is a person, not a task. It gates §1's Gmail variables and §3's function,
and it is the reason those values have been held back rather than copied across
(`end-of-project/outreach-prod-env.md`). Get it before the keys go in, not after.

If the answer is "not yet": do §1's non-Gmail rows, §4, and §5 anyway. Production
can be fully functional for reading, importing and analysis with sending off —
every send returns *"Gmail is not configured."* and no cron job is harmed by it.

### 0.2 Already done — do not redo

Verified on production and recorded in [production-deployment.md](production-deployment.md):

- Production's **own** Turnstile widget, with its secret configured on the
  production Supabase project (30 July 2026). Re-check only if a key rotated.
- The required Vercel variables from the 28 July audit: `NEXT_PUBLIC_TURNSTILE_SITE_KEY`,
  `SESSION_ACTIVITY_SECRET`, `NEXT_PUBLIC_SENTRY_DSN`.
- The five GitHub Actions secrets/variables the nightly backup needs.
- A restore from a Blob dump, proved by hand.

### 0.3 The release itself

```bash
git fetch origin && git log --oneline origin/main..origin/dev
```

A large gap is not a fault — `main` trails `dev` between releases, and that gap
*is* the unreleased queue. Review the release PR as a release, not as one change.
Check the two repo variables the production probes hang off, which the workflow
skips *silently* when absent:

- `SUPABASE_PROD_URL`
- `SUPABASE_PROD_ANON_KEY`

With either unset, `migrations.yml`'s production anonymous-lockout probe does not
run, so the one post-deploy check that the RLS policies actually reached
production never happens.

---

## 1. Vercel — production environment variables

Vercel → `180connect` → Settings → Environment Variables, **tick Production**, or:

```bash
vercel env add <NAME> production
```

**Editing a variable changes nothing until you redeploy.** Vercel reads the
environment at build time, and `NEXT_PUBLIC_*` values are inlined into the
browser bundle. §5 starts with the redeploy for that reason.

### Group A — the build refuses to start without these

A successful production deployment is itself the proof this group is covered:
`assertEnv()` in `src/instrumentation.ts` fails startup outright on a missing
required value. If production is deployed at all, these are set.

| Variable | Value |
| --- | --- |
| `NEXT_PUBLIC_APP_URL` | `https://180connect.vercel.app` |
| `NEXT_PUBLIC_SUPABASE_URL` | the production project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | production publishable key (`sb_publishable_…`) — or the legacy `NEXT_PUBLIC_SUPABASE_ANON_KEY`, either satisfies the pair check |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | production's own widget key — set since 30 July |

### Group B — a deployment succeeds without these, and is quietly broken

Marked `required: false` because they are genuinely optional locally. **All of
them must be set in production.** Nothing fails loudly; you find out from a user.

| Variable | What is dead without it |
| --- | --- |
| `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`, `GMAIL_SENDER_EMAIL` | Client outreach. Every send returns *"Gmail is not configured."* All four together or none — a partial set refuses to boot. Sender is `clients.sheffield@180dc.org`. Gated by the §0.1 decision. |
| `CRON_SECRET` | **Every scheduled job.** Every cron job that calls an app route is `CRON_SECRET`-gated; without the match in §2 and §3 they all 401 and report a successful run having done nothing. See §2 for the three-place rule. |
| `SESSION_ACTIVITY_SECRET` | Session expiry records go unsigned and forgeable, and password reset refuses to run. Fails silently — re-check after any Vercel environment change. |
| `SUPABASE_SERVICE_ROLE_KEY` | The login brute-force throttle goes to a no-op, and a suspended user meets a confusing error instead of a refusal. |
| `RESEND_API_KEY` + `EMAIL_FROM` | Platform email — invites, notifications. See §4. Both or neither: a key with no verified sender is refused at send time, one silent failure per invite. |

### Group C — decide each one deliberately

| Variable | Production value |
| --- | --- |
| `EMAIL_RECIPIENT_ALLOWLIST` | **Leave unset.** This is the one variable whose production value is *absence*: unset means no restriction. It is set on staging, so a copied environment starts silently dropping mail. Set it to `180dc.org` only if you want a guard during the pilot. |
| `NEXT_PUBLIC_ENV` | Unset, or `production`. Both show no preview banner; `staging` would. |
| `NEWS_HOOK_PROVIDER`, `EXA_API_KEY` | Optional. Leave unset during go-live — unset means `none` and Stage 2 follow-ups generate without a news hook, which is the documented safe state. Set both together when you want hooks. |
| `SENTRY_ENVIRONMENT` | Optional; falls back to Vercel's `VERCEL_ENV`, which already distinguishes the two. |
| `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_SEARCH_MODEL` | Without these, booklet generation, email drafts and natural-language search are all unavailable. `GEMINI_MODEL` has no default on purpose — copy the exact id from AI Studio. |
| `COMPANIES_HOUSE_API_KEY`, `CHARITY_COMMISSION_API_KEY`, `CHARITYBASE_API_KEY` | Ingestion sources that still call an API. CharityBase's own API is currently down on their end. |
| `EMAIL_SEND_RATE_LIMIT`, `AI_*_RATE_LIMIT` and window vars | Sensible defaults exist. Set only to override. |

Full variable-by-variable reference: [environment-variables.md](environment-variables.md).

---

## 2. Supabase production — four vault secrets

`CRON_SECRET` alone is not enough. Every scheduled job builds its URL and header
from **Supabase Vault**, not from Vercel — so the production project needs its
own copies. Run in **Dashboard → SQL Editor for `180connect-production`**:

```sql
select vault.create_secret('https://180connect.vercel.app', 'companies_house_cron_base_url');
select vault.create_secret('<openssl rand -hex 32>', 'cron_secret');
select vault.create_secret('<production Vercel project''s Protection Bypass secret>', 'vercel_protection_bypass');
select vault.create_secret('https://tugfhwiqvwrpvawpjwmd.supabase.co', 'supabase_project_url');
```

Three of these are per-environment values, so staging's will not do:

- **`companies_house_cron_base_url`** holds the *app base URL* — nothing to do
  with Companies House despite the name, which is kept as-is per
  `MIGRATIONS.md`'s no-rename-without-a-Wednesday-call rule. In production it is
  `https://180connect.vercel.app`; staging's is the dev branch alias.
- **`vercel_protection_bypass`** is generated per Vercel project. Every
  deployment on a non-custom domain is behind Vercel's SSO protection, so an
  unauthenticated `net.http_post` is intercepted at the edge before the route
  handler ever checks `CRON_SECRET`. Without it the jobs silently no-op. Get it
  from the production project's Deployment Protection settings (Protection
  Bypass for Automation); the migration that introduced the mechanism
  (`20260810100000`) generated it via `PATCH /v1/projects/{id}/protection-bypass`.
- **`supabase_project_url`** is required only by the 30-second reply check in §3.
  Until it exists, that job selects no row and makes no request.

### `CRON_SECRET` lives in three places and they must be identical

| # | Where | Read by |
| --- | --- | --- |
| 1 | Vercel → Production → `CRON_SECRET` | every `/api/cron/*` route handler |
| 2 | production Supabase → vault → `cron_secret` | pg_cron, as the `Bearer` header |
| 3 | production Supabase → Edge Function secrets → `CRON_SECRET` | the `gmail-reply-check` function's own check |

Any mismatch is a 401, and a 401 from a cron job is invisible: the job reports
successfully *ran*, having done nothing. Use one value; `openssl rand -hex 32`.

Changing any of these needs no migration — the jobs read the vault at call time.
Changing #1 additionally needs a **redeploy** to take effect.

---

## 3. Supabase production — the reply-check edge function

`gmail-reply-check` is what puts a client's reply in `/inbox` within about 30
seconds instead of on the five-minute sweep. `docs/gmail-reply-check.md` documents
this walk for staging only; production needs the same thing against its own ref.
Gated by the §0.1 decision.

### 3.1 Function secrets

```bash
supabase secrets set --project-ref tugfhwiqvwrpvawpjwmd \
  GMAIL_CLIENT_ID='<same as Vercel Production>' \
  GMAIL_CLIENT_SECRET='<same as Vercel Production>' \
  GMAIL_REFRESH_TOKEN='<same as Vercel Production>' \
  CRON_SECRET='<the same value as #1 and #2 above>'
```

The workflow does **not** deploy secrets — they are set once per project, by hand.

### 3.2 Deploy

Automatic on push to `main`: `.github/workflows/edge-functions.yml` targets
`vars.SUPABASE_PROD_REF` on the `main` branch. By hand, before that workflow
reaches `main`:

```bash
supabase functions deploy gmail-reply-check --project-ref tugfhwiqvwrpvawpjwmd --use-api
```

`--use-api` bundles on Supabase's side, so Docker is not needed. `verify_jwt = false`
in `supabase/config.toml` is deliberate — the function checks `CRON_SECRET` itself.

### 3.3 Verify

```bash
curl -X POST https://tugfhwiqvwrpvawpjwmd.supabase.co/functions/v1/gmail-reply-check \
  -H "Authorization: Bearer <CRON_SECRET>" -H "Content-Type: application/json" \
  -d '{"appBaseUrl":"https://180connect.vercel.app","vercelProtectionBypass":"<bypass>"}'
# → {"listed":0,"new":0}
```

Skipped entirely, replies still arrive — just on the five-minute poll rather than
in half a minute. Troubleshooting table: [gmail-reply-check.md](gmail-reply-check.md).

---

## 4. Resend — two keys, two places

`RESEND_API_KEY` is read by the app, but Supabase Auth sends password-recovery
mail itself and cannot read Vercel's environment, so it needs its own copy. The
failure is the nastiest one in this document: the reset form deliberately shows
*"if an account exists, we've sent instructions"* whether or not the send worked,
so a dead credential looks exactly like a working one until somebody locked out
of their account says so.

Create **two** keys in Resend, named so it is obvious which is which. (A third
lives in `.env.local` for local development — out of scope here, but the same
rule applies: the app's key and the SMTP key stay separate.)

| Key | Goes in |
| --- | --- |
| `180connect-app` | Vercel → Production → `RESEND_API_KEY` (plus `EMAIL_FROM`) |
| `180connect-supabase-smtp` | `180connect-production` → Authentication → **SMTP** settings |

One key in both places means rotating for either reason takes down the other.

**Verify by doing it, not by reading it:** request a real password reset against
production and confirm the mail arrives. Nothing else proves the SMTP row.

Rotation order and the full walk: [secrets.md](secrets.md).

---

## 5. Verify

### 5.1 Redeploy

Vercel → Deployments → the latest Production deployment → **Redeploy**. Non-optional
after any §1 change: the live site keeps the old values until a new build.

### 5.2 The things a person can see

Open production's dashboard as an admin. The **System health** card
(`src/lib/dashboard/system-health.ts`) reads every job's newest run and says so in
the words of the job. After the first tick of each cadence, no row should read
*"Waiting for its first run"* or *"Last run failed"* — those are the readings that
mean §2 is wrong:

| Row on the card | Watches |
| --- | --- |
| Reply sync | `gmail_reply_sync` |
| Scheduled sending | `scheduled_outreach_delivery` |
| 360Giving grants | `three_sixty_giving_backfill` |
| Stalled and no-reply checks | `stall_detection_daily`, `no_response_sweep_daily` |
| Reminders and digests | `reminder_notifications_daily`, `team_activity_digest_hourly` |
| Financials refresh | `charity_commission_financial_refresh_weekly` |

Housekeeping jobs (log and notification pruning, and the fast conditional nudge
that sits beside the reply sweep) are deliberately not rows — nobody can act on
them. Financials refresh is the one weekly row, so on most days
it will not have a fresh reading; that is expected, not a fault. Cadences live in
the jobs' own migrations and in `SCHEDULED_TASKS` (`src/lib/dashboard/system-health.ts`)
rather than here, because they change.

The card's **Gmail** row is the one entry that does a live round trip, which makes
it the proof that §1's Gmail variables are right — it reports connected on the
strength of the key alone for the other services.

### 5.3 Login still works

A Turnstile key pair is a pair, and the failure mode is that *nobody can log in*:

```bash
curl -s -X POST "https://tugfhwiqvwrpvawpjwmd.supabase.co/auth/v1/token?grant_type=password" \
  -H "apikey: <production publishable key>" \
  -H "Content-Type: application/json" \
  -d '{"email":"nobody@180dc.org","password":"wrong"}'
```

Expect `captcha_failed`. `invalid_credentials` means the site key and secret are
from different widgets. Then complete one real login in a real browser — Turnstile
serves headless browsers a challenge, so the happy path cannot be automated.

### 5.4 One real send, end to end

After §1 and the decision: send one test email from production to an internal
address. Then schedule one about six minutes out and watch
`outreach_messages.send_status` move `scheduled` → `sent`. Then reply to it from
an address you control and watch it appear in the open `/inbox` without a reload.

### 5.5 The backup actually fires

Every backup run so far has been manual. Check the Actions tab **after the next
03:00 UTC** and confirm a scheduled run appeared on its own. Scheduled runs
execute from the default branch (`dev`), so this does not wait on the release.

---

## When something is wrong, it looks like this

| Symptom | Cause |
| --- | --- |
| Everything works except sending: *"Gmail is not configured."* | §1 Group B, or the §0.1 decision was never given |
| Cron rows say *"Waiting for its first run"*, for ever | §2 — a missing vault secret makes the URL `NULL` and the request never leaves |
| Cron rows say *"Last run failed"* | §2 — mismatch between vault `cron_secret` and Vercel `CRON_SECRET` (401) |
| The job ran and did nothing | Mismatch between vault `cron_secret` and Vercel `CRON_SECRET` |
| `400 appBaseUrl missing or not https` from the function | vault `companies_house_cron_base_url` missing or not `https` |
| `502` with `syncStatus: 401` | Vercel's `CRON_SECRET` differs from the function's |
| `502` with `syncStatus: 401` and an HTML login page | `vercel_protection_bypass` missing or from the wrong Vercel project |
| No calls in the function's logs | vault `supabase_project_url` missing (§2), or the function was never deployed (§3.2) |
| Password recovery sends nothing | §4 — the Supabase SMTP half, not the Vercel half |
| An invite sits in `warning` | `RESEND_API_KEY` / `EMAIL_FROM` wrong, or the sender's domain is not verified in Resend |

---

## Not on this page

- **How the deployment pipeline itself works**, rollbacks, branch protection and
  the CAPTCHA setup: [production-deployment.md](production-deployment.md).
- **Schema work** the Data Model calls for that the database does not have yet,
  and everything else deliberately deferred: [end-of-project/](end-of-project/README.md).
  Go-live does not wait on any of it — see
  [end-of-project/data-model-gaps.md](end-of-project/data-model-gaps.md).
- **Secrets discipline**, what stops a key reaching the repository, and rotation:
  [secrets.md](secrets.md).
