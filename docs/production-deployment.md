# Production Deployment (F230)

**Status:** Deployment pipeline verified working 22 July 2026. Re-checked against
the current environment schema and F225's backup workflow on 28 July 2026, and
the outstanding dashboard items confirmed by Bashir the same day — production
env vars are set, and a restore from a Blob dump succeeded. AC2 is met; AC3 is
met on process and accepted as unenforceable on this GitHub plan (D-03). One
item remains unobserved rather than unresolved: the nightly backup cron firing
unattended. **Open issue found 30 July 2026:** the login CAPTCHA (F003) is not
enforced in production — the site key is set in Vercel but the paired secret was
never configured on the production Supabase project, so the widget renders and its
token is never validated. Fix in [Environment variables](#the-captcha-needs-a-second-non-vercel-half).
**Last updated:** 30 July 2026
**Component Owner:** Ben. **Reviewer:** Bashir.

---

## Production at a glance

| Item | Value |
|---|---|
| URL | `https://180connect.vercel.app`[^1] |
| Vercel Production Branch | `main` |
| Vercel Preview Branch | `dev` |
| Production Supabase project | `180connect-production` (ref `tugfhwiqvwrpvawpjwmd`, eu-west-1) — see [staging-environment-setup.md](staging-environment-setup.md) |
| Staging/preview Supabase project | `180connect-staging` (ref `cgbfhhdeapasniudyyds`, eu-west-2) |
| Auto-deploy on merge to `main` | Confirmed working, 22 July 2026 |
| Auto-deploy on merge to `dev` | Confirmed working, 22 July 2026 |

> The production project is `180connect-production`, not `180connect-prod` — the
> shortened form appears in older docs written before the project existed. Names
> verified against the Supabase API on 28 July 2026; see Q-04 in
> [open-questions.md](open-questions.md).

---

## The pipeline

```
feature branch → PR → dev (auto-deploys; shared preview/staging) → PR → main (auto-deploys; production)
```

- Every change lands on `dev` first and is exercised there before going anywhere near `main`.
- `main` therefore trails `dev` between releases — that gap *is* the unreleased queue. Check it before opening a release PR:
  ```
  git fetch origin && git log --oneline origin/main..origin/dev
  ```
  A large gap is not a fault, but it does mean the release PR carries more than one change, so review it as such.
- **Merging `dev` → `main` is a PM decision** — this keeps a human gate in front of every production release, per the project's SOP ("small, reviewable changes" + "evidence in staging before main").
- `vercel.json` at the repo root is the source of truth for which branches deploy at all:
  ```json
  { "git": { "deploymentEnabled": { "**": false, "dev": true, "main": true } } }
  ```
  Only `dev` and `main` build. Individual feature/PR branches (e.g. `225-f230-production-environment`) do **not** get their own preview URL, regardless of what `docs/staging-workflow-quick-ref.md` currently says.[^2]

---

## Environment variables

The 22 July check covered every variable that was `required: true` in `src/lib/env.ts` (added by F231) at the time: `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_SUPABASE_URL`, and one Supabase key. Since then `NEXT_PUBLIC_TURNSTILE_SITE_KEY` (F003, the login CAPTCHA) has also become `required: true` — the server refuses to start without it.

**Re-confirmed against the live Vercel production dashboard on 28 July 2026 (Bashir).** The three variables that were outstanding are all set in Production:

| Variable | `required` | Status |
|---|---|---|
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | `true` | Set, but **currently the staging widget's key** (`0x4AAAAAAD81XDBIWhZcPxMY`, the value PR #271 introduced for staging) — and the matching secret is not configured on the production Supabase project, so the CAPTCHA is not enforced in production. See [The CAPTCHA needs a second, non-Vercel half](#the-captcha-needs-a-second-non-vercel-half) below |
| `SESSION_ACTIVITY_SECRET` | `false` in schema, **mandatory in practice** | Set — without it the session-expiry record is unsigned and forgeable |
| `NEXT_PUBLIC_SENTRY_DSN` | `false` | Set — F226 error logging reaches Sentry rather than only the platform console |

`SESSION_ACTIVITY_SECRET` is marked `required: false` because it is genuinely optional locally, but staging and production must set it — the schema comment in `src/lib/env.ts` says so, and it is the one variable here that fails *silently* rather than loudly. Re-check it after any Vercel environment change; a missing value will not fail the build.

A build with a missing *required* variable fails startup outright (`assertEnv()` in `src/instrumentation.ts`), so a successful deployment is itself proof the required set is covered. That guarantee does not extend to the `required: false` ones above — hence the dashboard check.

Full variable-by-variable reference: [environment-variables.md](environment-variables.md).

### The CAPTCHA needs a second, non-Vercel half

`NEXT_PUBLIC_TURNSTILE_SITE_KEY` being set in Vercel is only half of F003. Turnstile
is a key *pair*: the site key identifies the widget in the browser, and the paired
**secret key** validates the token. The app never reads the secret — Supabase does,
from **Authentication → Attack Protection** in that project's dashboard. Setting the
site key alone gets you a widget that renders, issues a token, and is never checked
by anyone.

**Status 30 July 2026 — production is in exactly that state.** Probing each project's
sign-in endpoint with no CAPTCHA token:

| Supabase project | Response to a token-less sign-in | Enforcing? |
|---|---|---|
| `180connect-staging` | `captcha_failed` — "no captcha_token found" | Yes |
| `180connect-production` | `invalid_credentials` | **No** |

So on production the widget is decorative: a bot can POST straight to
`/auth/v1/token`, skip the login form entirely, and the CAPTCHA never applies.
Neither F003 PR (#271, #274) could have prevented this — the production project was
created on 20 July, after #271 merged, and #271 only ever enabled CAPTCHA on
staging. `supabase/config.toml`'s `[auth.captcha]` block configures the *local* stack
only; it has no effect on any hosted project.

Production also shares staging's Cloudflare widget rather than having its own, which
means one secret across both environments — rotating staging's key would break
production, and the two environments' traffic is indistinguishable in Cloudflare's
analytics.

To close both, in this order:

1. **Cloudflare → Turnstile → Add widget.** Name it `180connect-production`, hostname
   `180connect.vercel.app`, mode Managed. Keep the site key and the secret key.
2. **Supabase → `180connect-production` → Authentication → Attack Protection.** Enable
   CAPTCHA protection, provider **Turnstile**, paste the **secret** key, save.
3. **Vercel → Settings → Environment Variables.** Edit
   `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, **Production scope only**, to the new **site** key.
4. **Redeploy production.** `NEXT_PUBLIC_*` values are inlined at build time, so the
   env change does nothing until a rebuild — see [Changing a production environment
   variable](#changing-a-production-environment-variable).

Steps 2–4 must not be separated for long. Between enabling the secret and shipping
the matching site key, production is serving a site key from a *different* widget, so
every token fails validation and **nobody can log in**. Do them back to back and
verify immediately.

Verify with the same probe (expect `captcha_failed`, not `invalid_credentials`):

```bash
curl -s -X POST "https://tugfhwiqvwrpvawpjwmd.supabase.co/auth/v1/token?grant_type=password" \
  -H "apikey: <production publishable key>" \
  -H "Content-Type: application/json" \
  -d '{"email":"nobody@180dc.org","password":"wrong"}'
```

then complete one real login in a real browser. Turnstile serves headless browsers an
interactive challenge and refuses to issue a token, so the happy path cannot be
automated — see PR #274.

**Before enabling this, check what else it gates.** Supabase applies CAPTCHA to
*every* auth action on the project, not just sign-in: sign-up, password recovery, OTP
and resend all start requiring a token. As of 30 July 2026 only `/login` and
`/forgot-password` reach those methods and both already render the widget, so nothing
else breaks. Password reset itself is safe — it goes through `updateUser`, which is
not gated. Any future flow that signs up or invites a user (F008) must add
`TurnstileChallenge` before it ships.

---

## Backups and error logging (AC2)

Both landed on `dev` after the 22 July check and are now merged into this branch:

- **Backups (F225, closed 25 July):** [`.github/workflows/backup-production.yml`](../.github/workflows/backup-production.yml) dumps the production database nightly at 03:00 UTC (roles, schema, auth data, public data as four separate files) and uploads them to Vercel Blob storage, pruning anything older than 30 days. It needs five GitHub repository variables/secrets under Settings → Secrets and variables → Actions:

  | Name | Kind | Used for |
  |---|---|---|
  | `SUPABASE_PROD_REF` | Variable | Pooler username (`postgres.<ref>`) |
  | `SUPABASE_PROD_POOLER_HOST` | Variable | `PGHOST` for the dump |
  | `SUPABASE_PROD_DB_PASSWORD` | Secret | `PGPASSWORD` |
  | `BLOB_READ_WRITE_TOKEN` | Secret | Writing dumps to Blob storage |
  | `VERCEL_TOKEN` | Secret | Account token the Blob upload/prune steps also require |

  **Status 28 July 2026:** all five are set — a manual `workflow_dispatch` run went green (`gh run list --workflow=backup-production.yml`; two earlier attempts on 27–28 July failed before the token set was complete). **The nightly schedule has not yet been observed firing on its own** — every run so far was manual, so confirm a scheduled run appears after the next 03:00 UTC before treating the cron as proven. Note scheduled runs execute from the default branch (`dev`), where this workflow already lives, so merging to `main` is not a prerequisite. Full detail and the restore procedure: [F225-database-backups.md](Backups/F225-database-backups.md), [backup-setup.md](Backups/backup-setup.md).
- **Error logging (F226, closed 20 July):** wired through `NEXT_PUBLIC_SENTRY_DSN`, confirmed set in the Vercel production dashboard on 28 July 2026 — see the environment variables section above.

**AC2 is met.** F230's AC2 asks for "backup and error logging requirements active and functioning, not just staging". As of 28 July 2026: the backup workflow has run green against the real production project, **a restore from one of those Blob dumps has been performed successfully** (Bashir), and Sentry is wired up in production. The one thing still unobserved is the nightly schedule firing on its own — every run so far was triggered manually — so check the Actions tab after the next 03:00 UTC.

---

## Deploying to production

### Normal release

1. Confirm the change has already been merged to `dev` and tested against the shared `dev`/preview deployment.
2. Open a PR from `dev` into `main`. **Only PM merges this PR** — this is the human gate the process currently relies on. It is a convention, not a technical block, and cannot be made one on the current GitHub plan — see [Branch Protection Spec](branch-protection-spec.md).
3. Once merged, Vercel picks up the push to `main` automatically — no manual "deploy" step. Watch the **Deployments** tab in Vercel; the new build usually goes live within a couple of minutes.
4. Confirm the live site at `https://180connect.vercel.app` reflects the change.
5. Check Sentry (and `ERROR_LOG` once F221 lands) for any new errors in the minutes after deploy.
6. If the release touches authentication, or changed a Turnstile key on either side,
   confirm the CAPTCHA is still enforced — a token-less sign-in against the production
   Supabase project must come back `captcha_failed`, and one real login in a real
   browser must still succeed. A widget that renders proves nothing on its own; see
   [The CAPTCHA needs a second, non-Vercel half](#the-captcha-needs-a-second-non-vercel-half).

### If a production deploy breaks something

Vercel keeps every past deployment. In the **Deployments** tab, find the last known-good deployment and use **"Promote to Production"** (sometimes shown as "Instant Rollback") — this points the production URL back at the old build immediately, without needing a revert commit or a new build. Fix the actual problem on `dev` afterwards and go through the normal release process again.

### Changing a production environment variable

Editing a variable in Settings → Environment Variables does **not** update the live site by itself — Vercel only reads env vars at build time. After changing one, go to the latest Production deployment in the **Deployments** tab and choose **Redeploy** (without changing any code) so the new value actually takes effect.

Some variables also have a half that does not live in Vercel at all, and changing one
side without the other breaks the feature. `NEXT_PUBLIC_TURNSTILE_SITE_KEY` is the
current example — its secret lives in the Supabase dashboard, and the two must be
from the same Cloudflare widget. [environment-variables.md](environment-variables.md)
marks which variables those are.

### Branch protection

`main` has no GitHub branch protection, so AC3's "not an ad hoc action any team member could do differently" is enforced only by convention today. This is **not** a task waiting on someone with admin: branch protection and rulesets are gated behind a paid plan for private repositories, and this repo is private on GitHub Free (`gh api …/rulesets` → `403 "Upgrade to GitHub Pro or make this repository public"`, checked 28 July 2026). Unblocking it costs money or means going public. See [Branch Protection Spec](branch-protection-spec.md) for the options and the rule to apply if the plan ever changes; recorded as accepted deviation D-03 in [open-questions.md](open-questions.md).

## Related files

- [Staging Environment Setup](staging-environment-setup.md)
- [Environment Variables](environment-variables.md)
- [Open Questions](open-questions.md)
- [Branch Protection Spec](branch-protection-spec.md)

---

[^1]: Custom domain vs default `.vercel.app` URL was an open question on the F230 ticket ("Blocked By: Hosting provider/domain"). **Resolved 27 July 2026: the default `https://180connect.vercel.app` URL is the confirmed production address** — no custom domain is being set up for this project.

[^2]: Vercel's Hobby (free) plan allows only one real collaborator on a private-repo project. Deployments are gated by whether the *commit author's* GitHub account is recognized as a contributor on the Vercel project — logging into a shared Vercel dashboard account does not bypass this. Reproduced 22 July 2026: a push authored by Ben to `220-f225-database-backups` was rejected with *"The deployment was blocked because the commit author did not have contributing access to the project on Vercel. The Hobby Plan does not support collaboration for private repositories."* Only Bashir's commits currently deploy.
