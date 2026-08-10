# Open questions and accepted deviations

Decisions that are **not resolved in code** and need a human call, plus places where we have knowingly departed from the PRD. Raise these at the next team meeting.

Last updated: 28 July 2026 (D-01 updated, D-03 added, Q-04 resolved).

---

## Accepted deviations from the PRD

These are conscious departures. They are recorded here so they are not mistaken for oversights, and so the PRD's acceptance criteria are not quietly assumed to be met.

### D-01 — Backups exist; point-in-time recovery still doesn't (updated 28 July 2026)

**PRD says:** §16.3 step 17 requires daily backups and point-in-time recovery. MVP acceptance journey **#13** is *"Backup restore is demonstrated and documented."*

**We are doing:** The third option below — a scheduled `pg_dump` to external storage — was built and shipped as F225 (closed 25 July 2026). [`.github/workflows/backup-production.yml`](../.github/workflows/backup-production.yml) dumps the production database nightly to Vercel Blob storage with a 30-day retention window; restore steps are documented in [F225-database-backups.md](Backups/F225-database-backups.md). True PITR is still not provided — the Supabase free plan doesn't offer it, and this workflow is daily snapshots, not continuous replay — so recovery is only ever accurate to the last nightly dump, not to the moment before a failure.

**Consequence:** Acceptance journey #13 (*"Backup restore is demonstrated and documented"*) is **met**. Backups: a `workflow_dispatch` run went green on 28 July 2026 and wrote dumps to Blob storage. Restore: **a restore from one of those Blob dumps was performed successfully on 28 July 2026** (Bashir), so the "demonstrated" half is satisfied, not just documented. The nightly schedule has not yet been observed firing unattended — every run so far was manual — so confirm one appears after the next 03:00 UTC.

What remains a genuine deviation is **PITR only**: recovery is accurate to the last 03:00 UTC snapshot, never to the moment before a failure. Up to 24 hours of writes can be lost. The free plan offers no continuous replay.

**To resolve (if PITR is still wanted):** Upgrade to Supabase Pro (~$25/month, which also removes the pausing and the 500 MB cap). Otherwise nightly-snapshot recovery stands as the accepted position.

**Owner:** Project Leader. **Decide by:** before real organisation data is loaded.

---

### D-02 — Two environments, not three

**PRD says:** §9.2 requires development, staging, and production with separate databases, and pull-request preview deploys connected to staging data, never production.

**We are doing:** Development and production only, using free Supabase plan intelligently. Dev/preview share one Supabase project (safe for testing), production is separate.

**Resolution:** Implemented a staging-first architecture that:
- Uses free plan's 2-project limit: `180connect-staging` (local dev + Vercel previews) and `180connect-production` (production) — see Q-04 for the naming decision
- Ensures all PR previews point to dev database (safe to test)
- All migrations are Git-based, so schema is deterministic across all environments
- See [Staging Environment Setup](staging-environment-setup.md) for complete architecture

**Documentation created:**
- `docs/staging-environment-setup.md` — comprehensive guide
- `docs/staging-workflow-quick-ref.md` — developer quick reference
- `docs/staging-implementation-checklist.md` — setup checklist
- `docs/environment-variables.md` — technical specification

**Owner:** Mohammed (Component Owner F229). **Status:** Implemented (F229).

---

### D-03 — No branch protection on `main` — **DECIDED 28 July 2026: not upgrading**

**PRD/SOP says:** production changes should be small, reviewed and human-gated. F230's Acceptance Criterion 3 requires deploying to production to be a defined process *"rather than being an ad hoc, undocumented action any team member could do differently."*

**We are doing:** enforcing that by convention only — PM opens and merges the `dev` → `main` release PR, every change reaches `main` via `dev`. Nothing in GitHub stops a direct push to `main` or an unreviewed merge.

**Why:** branch protection rules and rulesets are gated behind a paid plan for **private** repositories, and this repo is private on GitHub Free. Confirmed 28 July 2026 — `gh api repos/180dcconnect/180Connect/rulesets` returns `403 "Upgrade to GitHub Pro or make this repository public to enable this feature."` This is a plan limit, not a permissions one; repo admin cannot switch it on.

**Consequence:** AC3 is met on the "documented process" half and permanently unmet on the "technically enforced" half. A team member with push access can bypass the process without anything blocking or flagging it. Nothing logs or reverts such a push — if it happens, it is caught by someone noticing, not by tooling.

**Decision (Project Leader, 28 July 2026):** **not paying for GitHub Pro.** The repo stays private on the Free plan, and AC3 stays convention-enforced for the life of the MVP. This is a deliberate, accepted risk, not a pending task — the spec doc is retained only so the rule can be applied quickly if the plan ever changes.

**What we rely on instead:** the PM is the only person who opens and merges the `dev` → `main` release PR; every change reaches `main` through `dev`; release PRs are reviewed like any other. See [Branch Protection Spec](branch-protection-spec.md) and [production-deployment.md](production-deployment.md).

**Revisit if:** someone merges to `main` without review in practice, the team grows beyond the people who know the convention, or the repo moves to an organisation for other reasons.

**Owner:** Project Leader. **Status:** Closed — accepted.

---

## Blocking decisions

These change what gets built and are needed soon.

### Q-01 — Supabase plan

The single decision underneath both D-01 and D-02. Free plan also caps the database at **500 MB**. The PRD's target scale is **100,000 organisations** *plus* `RAW_SOURCE_RECORDS` retaining raw JSON payloads from every ingestion run for traceability (§16.1). The raw payloads, not the organisations, are what will exhaust that.

**Action:** measure real payload size against a sample ingestion in Week 2–3, before committing to a plan. Do not discover this in Week 8.

### Q-02 — Scheduled-send cron

PRD §10 requires the scheduled-send worker to run *"at least every minute."* Vercel Cron on the Hobby plan is **daily-only**, so it cannot satisfy this.

**Proposed default:** Supabase `pg_cron` (runs on the free plan, supports minute granularity) calling a `CRON_SECRET`-protected route handler in the Next app. This keeps us off Vercel Pro and works on either plan.

**Owner:** Email epic owner. **Decide by:** before the scheduled-sending story starts (Week 5–6).

**Precedent shipped 9 Aug 2026:** the shape proposed here — `pg_cron` + `net.http_post` + a `CRON_SECRET`-checked route handler — is now live for the Companies House discovery and status-recheck jobs (`supabase/migrations/20260809100400_schedule_companies_house_cron.sql`, `src/app/api/cron/companies-house-import`, `src/app/api/cron/companies-house-status-recheck`). Those run weekly, not minute-granularity, so this proves the mechanism works end-to-end on the free plan, not yet minute-level cadence — the scheduled-send worker is still the one that needs that. `CRON_SECRET` is no longer "not yet consumed"; see `src/lib/env.ts`.

### Q-03 — LLM provider

PRD §22 leaves this open. Whatever we pick sits behind our own `LlmProvider` interface, so it is swappable — but a default is needed before the first booklet is generated.

**Owner:** Project Leader. **Decide by:** before the first production generation (Week 4–5).

### Q-04 — Supabase project naming — **RESOLVED 28 July 2026**

Both projects are now named explicitly for the environment they serve, so neither can silently become the other:

| Project | Ref | Region | Serves |
|---|---|---|---|
| `180connect-staging` | `cgbfhhdeapasniudyyds` | eu-west-2 | Local dev + Vercel preview (`dev` branch) |
| `180connect-production` | `tugfhwiqvwrpvawpjwmd` | eu-west-1 | Production (`main` branch) |

Note the production project is `180connect-production`, **not** `180connect-prod` — some older docs used the shortened form before the project existed. Verified against the Supabase API on 28 July 2026.

### Q-05 — CAPTCHA provider (RESOLVED)

PRD §22 leaves the CAPTCHA provider open. Supabase Auth's built-in CAPTCHA support only integrates with **hCaptcha** or **Cloudflare Turnstile** — Supabase does not run its own CAPTCHA, it verifies whichever provider's token is passed to it.

**Decision: Cloudflare Turnstile.** Free with no limits, usually invisible to the user, no cookies (relevant given the PRD's data-minimisation requirements in §15), and Cloudflare provides fixed test keys so local development and CI are never blocked.

**Important:** enabling CAPTCHA in Supabase applies to **every** auth action (login, password reset, invites, sign-up), not just login. The Turnstile widget must be added to each form that calls a Supabase auth method, not only `src/app/login/login-form.tsx`.

**Owner:** Component Owner F003. **Status:** Decided and implemented for login (F003); password reset (F004) and invites (F008) still need the same widget added.

### Q-06 — Viewer role scope — **RESOLVED 24 Jul 2026**

Raised by F258 (#268), which implemented the `viewer` role. `viewer` had sat in the `USERS.role` enum and throughout PRD §4.3 since the start with no story owning it, so nobody had ever decided what a viewer *is*. Three questions blocked pinning down its read scope. All three were answered by the Project Leader on 24 Jul 2026; all three resolve to **internal-only**, which is why the scope shipped in F258 needed no change.

**Who gets the role:** 180DC branch leadership — non-operational oversight. Explicitly **not** external stakeholders, and **not** onboarding CAMs (a new CAM is invited as a CAM). This is the answer that makes the other two cheap: every viewer is internal, so viewers may safely see what CAMs see.

**Communication timeline:** viewers read it in full — sent emails, replies, notes. Already the shipped behaviour (matrix §3.3, §3.4: SELECT to all roles). Had viewers been external this would have needed new policies on `NOTES`, `OUTREACH_MESSAGES` and `REPLY_EVENTS` plus a matrix rewrite.

**`CAM_ACTIVITY_SUMMARY`:** viewers **can** read it, in full. This resolves a direct contradiction — matrix §3.7 denied it, PRD §4.3 says "viewer read-only if authorised" — in favour of the PRD. It follows from the first answer: if a viewer is branch leadership, per-CAM throughput is the substance of the oversight the role exists to do, and withholding it would leave the role unable to do its job. The matrix §3.7 row was changed from `viewer: —` to `viewer: all`.

Worth stating plainly, because it is the one place a viewer sees something a CAM cannot: **a viewer reads every CAM's numbers, while a CAM reads only their own.** Read-only is not the same as sees-less-than-everyone, and the `user_id = auth.uid()` scoping on that table is a CAM rule specifically, not a general "non-admins see only themselves" rule. Anyone writing the policy for sequence step 13 should read it that way.

**Consequence for the PRD:** §4.3's "if authorised" is treated as satisfied by holding the Viewer role. There is no per-user analytics authorisation flag, and none is planned — the role *is* the authorisation. This is an interpretation of the PRD, not a deviation from it.

**Owner:** Project Leader. **Decided:** 24 Jul 2026. Recorded in `docs/rls-permission-matrix.md` §6.

---

## Known code debt

### C-01 — The login page is a visual mock

`src/app/login/page.tsx` was built from a design reference **before** the PRD was read. It currently contains affordances that **contradict PRD §4.2** ("Public self-sign-up is prohibited"; the authoritative role lives in `USERS`):

- "Sign up" tab and "Request access" link — there is no public sign-up in this product. Users are created or invited by an admin.
- **Continue with Google** and **Continue with Apple** buttons — there is no login SSO. Google OAuth exists in this product only to obtain **Gmail sending scopes** (§12.1), which is a different flow at a different point in the journey. Apple is not in scope at all.

The page also has no form action, no validation, and no server-side authentication of any kind.

**Confirmed with the project owner (14 July 2026): the PRD is correct and the page is a dummy.** These affordances will be removed when authentication is implemented (Workstream 2, F001–F007). They are left in place for now only so the deletion happens as part of that story rather than as an untracked drive-by change.

**Do not treat the current login page as a specification.**

### C-02 — Unused starter assets

`public/tree.jpg` is unused. The favicon is the Next.js default. Both to be cleared out during the foundations work.
