# Open questions and accepted deviations

Decisions that are **not resolved in code** and need a human call, plus places where we have knowingly departed from the PRD. Raise these at the next team meeting.

Last updated: 14 July 2026 (Week 1, Foundations).

---

## Accepted deviations from the PRD

These are conscious departures. They are recorded here so they are not mistaken for oversights, and so the PRD's acceptance criteria are not quietly assumed to be met.

### D-01 — No backups or point-in-time recovery

**PRD says:** §16.3 step 17 requires daily backups and point-in-time recovery. MVP acceptance journey **#13** is *"Backup restore is demonstrated and documented."*

**We are doing:** Neither. The Supabase free plan provides no PITR, and free projects pause after inactivity.

**Consequence:** Acceptance journey #13 **cannot pass** as written. There is no recovery path if the database is lost or corrupted — including by our own migration.

**To resolve:** Either upgrade to Supabase Pro (~$25/month, which also removes the pausing and the 500 MB cap), or formally descope acceptance journey #13 and amend the PRD through change control. A third option is a scheduled `pg_dump` to external storage — cheaper than Pro, weaker than PITR, and someone has to own it.

**Owner:** Project Leader. **Decide by:** before real organisation data is loaded.

---

### D-02 — Two environments, not three

**PRD says:** §9.2 requires development, staging, and production with separate databases, and pull-request preview deploys connected to staging data, never production.

**We are doing:** Development and production only. No staging.

**Consequence:** Preview deployments have nowhere safe to point. Either they point at production data (which §9.2 explicitly prohibits) or at a developer's database. With six developers on two teams, there is also no shared integration environment before production.

**To resolve:** The free Supabase plan allows two active projects per organisation, so a staging project is *possible* without upgrading — but it consumes the second slot, and the free-tier pausing makes it unreliable as a shared environment. Realistically this is the same decision as D-01: upgrade, or accept the gap.

**Owner:** Project Leader. **Decide by:** before the first pull request that touches the database.

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

### Q-03 — LLM provider

PRD §22 leaves this open. Whatever we pick sits behind our own `LlmProvider` interface, so it is swappable — but a default is needed before the first booklet is generated.

**Owner:** Project Leader. **Decide by:** before the first production generation (Week 4–5).

### Q-04 — Supabase project naming

The existing Supabase project is called **"Development"** (`cgbfhhdeapasniudyyds`, eu-west-2, org `180Connect`), and it is currently empty. Given D-02, it needs to be explicit which environment it *is*, so it does not silently become both dev and production.

**Owner:** Project Leader. **Decide by:** before the first migration is applied.

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
