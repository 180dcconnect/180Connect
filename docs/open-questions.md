# Open questions and accepted deviations

Decisions that are **not resolved in code** and need a human call, plus places where we have knowingly departed from the PRD. Raise these at the next team meeting.

Last updated: 9 September 2026 (D-05 added).

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

### D-04 — CharityBase import (F031) and field standardisation (F259) not built — upstream API is down

**PRD says:** Technical Brief → Data ingestion / External Data Sources lists CharityBase as one of the external sources to ingest charity records from, alongside Companies House and Charity Commission.

**We are doing:** Not building it, and closing both #33 (F031) and #313 (F259, which depends on F031's raw records) rather than leaving them open against a source with no working backend.

CharityBase's own GraphQL API (`https://charitybase.uk/api/graphql`) fails on every query with:

```
[index_not_found_exception] no such index, with { resource.id="charity_base_2025_03_charity" }
```

This is a dead index on their end, not an issue with our key or query:
- Verified live on 10 Aug 2026 with a freshly issued, valid API key — auth succeeds (`200 OK`, no auth error), the query is schema-valid, and the failure is Elasticsearch's `index_not_found_exception` leaking through their GraphQL layer.
- Both indexes backing the API are gone, not just one: `charity_base_2025_03_charity` (`getCharities`) and `charity_base_2025_03_filter` (`getFilters`) — i.e. their whole March-2025 dataset generation, not a single broken field.
- Their schema exposes no index/version selector (`getCharities` only takes a `filters` search argument) — there is no alternate index a client can request instead. The index name is hardcoded server-side in their resolver.
- This isn't new: Himanshu's first-draft adapter (`src/lib/ingestion/sources/charitybase.ts`, commit `73bf56d`) hit the same error and shipped with its own comment admitting "the following code does not work ATM." It was stripped out of the F038 PR and deferred to a follow-up (commit `13c5348`, PR #294) that was never opened. The outage has persisted from whenever that was written through to the live re-check on 10 Aug 2026.

**Consequence:** F031 and F259 are closed, not just deprioritised — there is nothing to build against today. Charity Commission (F033, PR #332) is the working equivalent for UK charity data and already covers the ingestion this would have added.

**Revisit if:** CharityBase's API starts returning data again. Spot-check: `POST https://charitybase.uk/api/graphql` with a valid `Authorization: Apikey <key>` header and body `{"query":"{ CHC { getCharities(filters: {}) { count } } }"}` — a working API returns a numeric `count`, not `index_not_found_exception`. If it starts working, F031/F259 should be reopened rather than rewritten from scratch — `73bf56d` has a rough starting point for the adapter shape.

**Owner:** Project Leader. **Decided:** 10 August 2026.

**Note (10 Aug 2026):** [`charity-base/charity-base-data`](https://github.com/charity-base/charity-base-data) shows CharityBase isn't a primary source — it's a wrapper that builds its index from Charity Commission extract/API + 360Giving GrantNav CSVs + postcode geo + social handles, then indexes to Elasticsearch. Repo last pushed 2023-01-11 (stale, not a viable self-host). Everything of substance behind CharityBase is already reachable directly: Charity Commission is built (F033, PR #332); 360Giving already sits in `DATA_SOURCES` (`src/lib/ingestion/type.ts`) as its own unbuilt source, worth a ticket in its own right with no CharityBase dependency. Doesn't change the close decision above.

---

### D-05 — Open, click and forward tracking (F140–F142) descoped; Gmail cannot report them

**PRD says:** §12.3 allows "optional tracking-pixel/redirect signals only after privacy and deliverability review", labelled as probabilistic. The Gantt already excludes `F140`, `F141` and `F142` from the 240 committed features (PRD §Scheduling), so none of the three was committed scope to begin with.

**We are doing:** Closing all three. That §12.3 review was carried out on 9 September 2026 and the answer is no.

**Why the provider cannot help.** Outreach is sent with Gmail API `users.messages.send` from the shared branch mailbox `clients.sheffield@180dc.org`. That call returns `{id, threadId, labelIds}` and nothing else. Gmail exposes no open events, no click events, no delivery receipt and no engagement webhook at any tier. Reply sync works by polling *our own* mailbox (`src/app/api/cron/gmail-replies/route.ts`), which tells us what arrived for us and nothing about what a recipient did. Bounces surface only as a mailer-daemon message arriving back in the mailbox, which is reply-sync parsing, not a delivery feed.

**Why we are not switching provider to get it.** Resend does offer opens, clicks and webhooks. It cannot be used for outreach:

- Verifying a domain in Resend means adding DKIM and SPF records to it. 180DC HQ has not granted DNS access to 180dc.org, so Resend can never put `clients.sheffield@180dc.org` in the From line. Sending charity outreach from an unrelated verified domain is not a degraded mode of the product.
- It would not remove the Gmail work anyway. A reply goes wherever `Reply-To` points — the Workspace mailbox — whichever provider sent the original. Reply sync is Gmail work in every scenario. Resend Inbound would need MX records on 180dc.org, i.e. taking over the branch's actual mail routing.

Note that the PRD's stated reason for preferring Gmail (§12.1: stable thread ids) is the weaker of the two arguments — a message we send through any provider carries a `Message-ID` we control, and replies can be matched on `In-Reply-To`/`References` from the Gmail side. **The binding constraint is DNS access, not threading.** Recorded so nobody revisits this on the wrong premise.

**Why not self-host a pixel and a link redirector.** Technically possible — HMAC token, `/api/t/...` routes, `send_events` writes through service_role — and rejected on merit:

- Opens would be measured, not accurate. Apple Mail Privacy Protection prefetches every remote image by default, and Gmail proxies and caches images. At a cap of 100 emails a day (PRD §7.9) there is no volume to average the distortion out, and a directionally wrong number a CAM acts on is worse than no number.
- Clicks are measurable but not meaningful on their own. The F117 rich-text body does allow a CAM to insert a link (`sanitizeEmailHtml` permits `<a href>` on `http`, `https` and `mailto`), so there is something to instrument — but a click count with no open count behind it has no denominator, and the ratio was the thing anyone wanted. There is no template, CTA or booking link in the product today either, so how often a link even appears is unknown.
- Link wrapping is a deliverability risk on the one mailbox that matters. Rewriting every href to a young, no-reputation redirector domain, with visible text not matching the destination, is a well-known phishing heuristic. Every CAM sends from the same shared Workspace mailbox (`clients.sheffield@180dc.org`), so one bad classification degrades outreach for the whole branch, not for one person. It would also visibly mangle a URL the CAM typed themselves — these are person-to-person emails, not campaign sends.
- Forwards (F142) have no reliable method at all — the issue says as much. The nearest honest signal is a reply from an unknown address at the contact's own domain, derivable later from `reply_events` at zero cost.

Each issue's own acceptance criteria anticipate this: F140 AC1 permits open tracking being "explicitly disabled and hidden in the UI rather than showing a metric that's always zero", and F142 AC1 permits descope-and-hide where no reliable method is agreed. Both are satisfied as written — no open-rate or click-rate metric exists anywhere in `src/`, so there is nothing displaying zero and nothing to remove. The outreach screen surfaces `send_events` only to show failures (`src/app/clients/[id]/outreach/page.tsx` filters `event_type = 'failed'`). F141 has no such clause, so it is closed as a change-control descope against this record.

**Consequence:** Engagement measurement for outreach rests on replies and outcomes — `reply_events` and `outcomes`, both already built and both ground truth rather than inference. `send_event_type` shipped as `('sent','delivered','bounced','opened')` and gained `'failed'` with F129, of which two values had no possible source; `supabase/migrations/20260924110000_trim_send_event_type.sql` recreates the type as `('sent','bounced','failed')`. `sent` is our own act and `failed` is F129's record of a send that never reached Gmail — both written today; `bounced` is unbuilt but observable, by parsing the mailer-daemon message that returns to the mailbox. Done now rather than deferred because nothing writes the table yet, so it is as cheap as it will ever be — and because `delivered` sitting in the enum is an invitation for whoever builds F130 to assume something can supply it.

**Data Model correction needed (owner: Project Leader).** Tab 07 SEND_EVENTS describes `occurred_at` as "Date and time Gmail reported the delivery event" and `metadata` as "Additional event information returned by the Gmail API". Gmail reports neither. The spreadsheet is the source of truth and `docs/data-model/` is generated from it, so this must be fixed in the xlsx (tab 07) and re-exported with `npm run export:data-model` — not hand-edited here. Suggested: drop `delivered` and `opened` from the enum, describe `occurred_at` as the time of the event as observed by the platform, and describe `metadata` as provider or parser detail for the event. `supabase/migrations/20260804200000_create_outreach_events.sql` is already applied and has not been edited — the enum change is a new forward migration, `20260924110000_trim_send_event_type.sql`, which also corrects the table and column comments that carried the same wrong Gmail attribution.

**Revisit if:** HQ grants DNS access to 180dc.org *and* outreach bodies start carrying real links *and* someone wants the number badly enough to accept it being approximate. All three, not any one.

**Owner:** Project Leader. **Decided:** 9 September 2026.

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

### Q-07 — Find That Charity (F034): source is unreliable, confirmed live

F034's own ticket flags "Find That Charity access/data quality" as an open question rather than a solved dependency. Verified live against `findthatcharity.uk` on 10 Aug 2026 (Bashir) — the flakiness a teammate reported is real and reproducible, not a bug in `find_that_charity.ts`. Same day as D-04's CharityBase finding above, different failure mode: CharityBase is permanently dead (every query fails the same way), Find That Charity is intermittent (roughly half of requests succeed fine) — worth reading together, not the same call.

**What was tested:** 15 sequential `GET` requests each against `/`, `/reconcile` (no query), and `/reconcile?queries=...` (the actual reconcile call the adapter makes).

**Result:** roughly **40–60% of requests hang indefinitely** — TCP connects, HTTP/2 stream opens, server never sends a response (no error, no 429, no 5xx, just silence until the client's own timeout fires). This happens on every endpoint tested, including the static base page, so it is host-wide, not specific to `/reconcile` or to query load. The requests that *do* return succeed fast (~0.5–0.7s) with correct data.

**Consequence for the adapter as written:** `reconcileOne()` retries 3× with a 15s timeout per attempt, sequentially, one name at a time (`MAX_NAMES_PER_RUN = 200`). Against a ~50% per-attempt hang rate:
- ~1 in 8 reconcile calls (0.5³) will still exhaust all 3 retries and throw, even though the source has no real problem with that particular query.
- a worst-case run can burn up to 200 × (3 × 15s) ≈ 2.5 hours before completing, because failures aren't a fast-fail (429/5xx) — they're a full-length hang on every attempt.

This is on top of the adapter's own already-flagged architectural point (no bulk endpoint, so this was never a traditional import) — the two compound: a name-by-name loop was already going to be slow, and doing it against a host that stalls half the time makes that worse, not just cosmetically slower.

**Not caused by:** rate limiting (fails on a cold first request), TLS/DNS (cert is valid, `findthatcharity.uk` resolves fine), or query shape (plain `/` fails the same way).

**To resolve:** re-test closer to when F034 is actually picked up — this may be a transient outage rather than a permanent property of the service. If it persists, options are (a) shorten the per-attempt timeout and raise attempt count so failures fail faster without changing total wait budget, (b) run reconciliation in small scheduled batches rather than one long synchronous run, or (c) park F034 (P2) until the host is stable, per the ticket's own "Blocked By" note.

**Owner:** Component Owner F034. **Status:** Open — needs a re-check before implementation resumes.

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
