# Production Deployment (F230)

**Status:** Verified working
**Last updated:** 22 July 2026
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

Production's Environment Variables in the Vercel dashboard were checked against the startup-validation schema in `src/lib/env.ts` (added by F231) and cover everything currently marked `required: true`: `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_SUPABASE_URL`, and one Supabase key (`NEXT_PUBLIC_SUPABASE_ANON_KEY`, present and valid — `env.ts` accepts this as a fallback for the newer `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` name). Preview (`dev`) is not fully required to be re-verified variable-by-variable, since a build with a missing required variable fails startup outright (`assertEnv()` in `src/instrumentation.ts`) — and the most recent `dev` deployment succeeded, which is itself evidence the required variables are present there too.

Full variable-by-variable reference: [environment-variables.md](environment-variables.md).

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

[^1]: Custom domain vs default `.vercel.app` URL is still an open question on the F230 ticket ("Blocked By: Hosting provider/domain"). 

[^2]: Vercel's Hobby (free) plan allows only one real collaborator on a private-repo project. Deployments are gated by whether the *commit author's* GitHub account is recognized as a contributor on the Vercel project — logging into a shared Vercel dashboard account does not bypass this. Reproduced 22 July 2026: a push authored by Ben to `220-f225-database-backups` was rejected with *"The deployment was blocked because the commit author did not have contributing access to the project on Vercel. The Hobby Plan does not support collaboration for private repositories."* Only Bashir's commits currently deploy.
