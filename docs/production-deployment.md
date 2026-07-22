# Production Deployment (F230)

**Status:** Verified working
**Last updated:** 22 July 2026
**Component Owner:** Ben. **Reviewer:** Bashir.

---

## Production at a glance

| Item | Value |
|---|---|
| URL | `https://180connect.vercel.app` |
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
  Only `dev` and `main` build. Individual feature/PR branches (e.g. `225-f230-production-environment`) do **not** get their own preview URL, regardless of what `docs/staging-workflow-quick-ref.md` currently says (see Known gaps below).

---

## Environment variables

Production's Environment Variables in the Vercel dashboard were checked against the startup-validation schema in `src/lib/env.ts` (added by F231) and cover everything currently marked `required: true`: `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_SUPABASE_URL`, and one Supabase key (`NEXT_PUBLIC_SUPABASE_ANON_KEY`, present and valid — `env.ts` accepts this as a fallback for the newer `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` name). Preview (`dev`) is not fully required to be re-verified variable-by-variable, since a build with a missing required variable fails startup outright (`assertEnv()` in `src/instrumentation.ts`) — and the most recent `dev` deployment succeeded, which is itself evidence the required variables are present there too.

Full variable-by-variable reference: [environment-variables.md](environment-variables.md).



## Related files

- [Staging Environment Setup](staging-environment-setup.md)
- [Environment Variables](environment-variables.md)
- [Open Questions](open-questions.md)
