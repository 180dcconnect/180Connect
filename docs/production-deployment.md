# Production Deployment (F230)

**Status:** Deployment pipeline verified working 22 July 2026. Re-checked against
the current environment schema and F225's backup workflow on 28 July 2026, and
the outstanding dashboard items confirmed by Bashir the same day — production
env vars are set, and a restore from a Blob dump succeeded. AC2 is met; AC3 is
met on process and accepted as unenforceable on this GitHub plan (D-03). One
item remains unobserved rather than unresolved: the nightly backup cron firing
unattended.
**Last updated:** 28 July 2026
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
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | `true` | Set — real key, not a Cloudflare test key |
| `SESSION_ACTIVITY_SECRET` | `false` in schema, **mandatory in practice** | Set — without it the session-expiry record is unsigned and forgeable |
| `NEXT_PUBLIC_SENTRY_DSN` | `false` | Set — F226 error logging reaches Sentry rather than only the platform console |

`SESSION_ACTIVITY_SECRET` is marked `required: false` because it is genuinely optional locally, but staging and production must set it — the schema comment in `src/lib/env.ts` says so, and it is the one variable here that fails *silently* rather than loudly. Re-check it after any Vercel environment change; a missing value will not fail the build.

A build with a missing *required* variable fails startup outright (`assertEnv()` in `src/instrumentation.ts`), so a successful deployment is itself proof the required set is covered. That guarantee does not extend to the `required: false` ones above — hence the dashboard check.

Full variable-by-variable reference: [environment-variables.md](environment-variables.md).

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

### If a production deploy breaks something

Vercel keeps every past deployment. In the **Deployments** tab, find the last known-good deployment and use **"Promote to Production"** (sometimes shown as "Instant Rollback") — this points the production URL back at the old build immediately, without needing a revert commit or a new build. Fix the actual problem on `dev` afterwards and go through the normal release process again.

### Changing a production environment variable

Editing a variable in Settings → Environment Variables does **not** update the live site by itself — Vercel only reads env vars at build time. After changing one, go to the latest Production deployment in the **Deployments** tab and choose **Redeploy** (without changing any code) so the new value actually takes effect.

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
