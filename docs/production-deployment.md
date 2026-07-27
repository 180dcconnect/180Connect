# Production Deployment (F230)

**Status:** Deployment pipeline verified working 22 July 2026. Re-checked against
the current environment schema and F225's backup workflow on 27 July 2026 —
see the flagged items below, which still need Bashir to confirm inside the
Vercel dashboard (this component owner has no Vercel access — see footnote 2).
**Last updated:** 27 July 2026
**Component Owner:** Ben. **Reviewer:** Bashir.

---

## Production at a glance

| Item | Value |
|---|---|
| URL | `https://180connect.vercel.app`[^1] |
| Vercel Production Branch | `main` |
| Vercel Preview Branch | `dev` |
| Production Supabase project | `180connect-prod` (see [staging-environment-setup.md](staging-environment-setup.md)) |
| Auto-deploy on merge to `main` | Confirmed working, 22 July 2026 |
| Auto-deploy on merge to `dev` | Confirmed working, 22 July 2026 |

---

## The pipeline

```
feature branch → PR → dev (auto-deploys; shared preview/staging) → PR → main (auto-deploys; production)
```

- Every change lands on `dev` first and is exercised there before going anywhere near `main`.
- **Merging `dev` → `main` is a PM decision** — this keeps a human gate in front of every production release, per the project's SOP ("small, reviewable changes" + "evidence in staging before main").
- `vercel.json` at the repo root is the source of truth for which branches deploy at all:
  ```json
  { "git": { "deploymentEnabled": { "**": false, "dev": true, "main": true } } }
  ```
  Only `dev` and `main` build. Individual feature/PR branches (e.g. `225-f230-production-environment`) do **not** get their own preview URL, regardless of what `docs/staging-workflow-quick-ref.md` currently says.[^2]

---

## Environment variables

The 22 July check covered every variable that was `required: true` in `src/lib/env.ts` (added by F231) at the time: `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_SUPABASE_URL`, and one Supabase key. Since then `NEXT_PUBLIC_TURNSTILE_SITE_KEY` (F003, the login CAPTCHA) has also become `required: true` — the server now refuses to start without it. **This has not been re-confirmed against the live Vercel production dashboard**, only against the schema in code; whoever holds Vercel access needs to check Settings → Environment Variables for production and confirm a real (non-test) Turnstile site key is set there, matching the secret configured in that Supabase project's Attack Protection settings.

Two more are worth a deliberate look even though they're `required: false` (so a missing value won't fail the build): `SESSION_ACTIVITY_SECRET` — optional locally, but the schema's own comment says staging and production must set it, since without it the session-expiry record is unsigned and forgeable — and `NEXT_PUBLIC_SENTRY_DSN` / `SENTRY_ENVIRONMENT`, which is how F226 (error logging, closed 20 July) actually reaches Sentry in production rather than just the platform console.

The fact that a build with a missing *required* variable fails startup outright (`assertEnv()` in `src/instrumentation.ts`) is good evidence Preview (`dev`) has its required set covered, since the most recent `dev` deployment succeeded — but it says nothing about the `required: false` ones above, which fail silently, not loudly, if left unset.

Full variable-by-variable reference: [environment-variables.md](environment-variables.md).

---

## Backups and error logging (AC2)

Both landed on `dev` after the 22 July check and are now merged into this branch:

- **Backups (F225, closed 25 July):** [`.github/workflows/backup-production.yml`](../.github/workflows/backup-production.yml) dumps the production database nightly at 03:00 UTC (roles, schema, auth data, public data as four separate files) and uploads them to Vercel Blob storage, pruning anything older than 30 days. It needs four GitHub repository variables/secrets set — `SUPABASE_PROD_REF`, `SUPABASE_PROD_POOLER_HOST`, `SUPABASE_PROD_DB_PASSWORD`, `BLOB_READ_WRITE_TOKEN` — under Settings → Secrets and variables → Actions. **Not yet confirmed these are actually set on the real repo** — check the Actions tab for a green run, or trigger one manually via `workflow_dispatch`. Full detail and the restore procedure: [F225-database-backups.md](Backups/F225-database-backups.md), [backup-setup.md](Backups/backup-setup.md).
- **Error logging (F226, closed 20 July):** wired through `NEXT_PUBLIC_SENTRY_DSN` — see the environment variables section above for what still needs confirming in the Vercel dashboard.

Both are required for F230's AC2 ("backup and error logging requirements active and functioning, not just staging"). The workflow file existing and the schema wiring being merged is not the same as confirming they are live and running against the real production project — that's the one check left before AC2 can be marked done in good faith.

---

## Deploying to production

### Normal release

1. Confirm the change has already been merged to `dev` and tested against the shared `dev`/preview deployment.
2. Open a PR from `dev` into `main`. **Only PM merges this PR** — this is the human gate the process currently relies on. It is a convention, not a technical block: `main` has no branch protection yet — see [Branch Protection Spec](branch-protection-spec.md).
3. Once merged, Vercel picks up the push to `main` automatically — no manual "deploy" step. Watch the **Deployments** tab in Vercel; the new build usually goes live within a couple of minutes.
4. Confirm the live site at `https://180connect.vercel.app` reflects the change.
5. Check Sentry (and `ERROR_LOG` once F221 lands) for any new errors in the minutes after deploy.

### If a production deploy breaks something

Vercel keeps every past deployment. In the **Deployments** tab, find the last known-good deployment and use **"Promote to Production"** (sometimes shown as "Instant Rollback") — this points the production URL back at the old build immediately, without needing a revert commit or a new build. Fix the actual problem on `dev` afterwards and go through the normal release process again.

### Changing a production environment variable

Editing a variable in Settings → Environment Variables does **not** update the live site by itself — Vercel only reads env vars at build time. After changing one, go to the latest Production deployment in the **Deployments** tab and choose **Redeploy** (without changing any code) so the new value actually takes effect.

### Branch protection

`main` has no GitHub branch protection yet, so AC3's "not an ad hoc action any team member could do differently" is enforced only by convention today. See [Branch Protection Spec](branch-protection-spec.md) for the gap and the exact rule to apply — applying it needs admin permission this component owner doesn't have.

## Related files

- [Staging Environment Setup](staging-environment-setup.md)
- [Environment Variables](environment-variables.md)
- [Open Questions](open-questions.md)
- [Branch Protection Spec](branch-protection-spec.md)

---

[^1]: Custom domain vs default `.vercel.app` URL was an open question on the F230 ticket ("Blocked By: Hosting provider/domain"). **Resolved 27 July 2026: the default `https://180connect.vercel.app` URL is the confirmed production address** — no custom domain is being set up for this project.

[^2]: Vercel's Hobby (free) plan allows only one real collaborator on a private-repo project. Deployments are gated by whether the *commit author's* GitHub account is recognized as a contributor on the Vercel project — logging into a shared Vercel dashboard account does not bypass this. Reproduced 22 July 2026: a push authored by Ben to `220-f225-database-backups` was rejected with *"The deployment was blocked because the commit author did not have contributing access to the project on Vercel. The Hobby Plan does not support collaboration for private repositories."* Only Bashir's commits currently deploy.
