# F225 — Database backup and restore strategy

Owner: Ben Phillips. Reviewer: Bashir Bobboi. Relates to open questions **D-01** and **Q-01** in [open-questions.md](open-questions.md) — read those first, they're the accepted-deviation record this doc turns into a working process. Written with Claude, checked and updated by Ben Phillips.

## Current state

The project's Supabase project ("Development") is on the **Free plan**. On Free:

- No automatic backups of any kind.
- No point-in-time recovery (PITR) — not available at any price below Pro.
- Free projects also pause automatically after a period of inactivity.

This is already recorded as an accepted PRD deviation (D-01): the PRD (§16.3 step 17) requires daily backups and PITR, and MVP acceptance journey #13 ("backup restore is demonstrated and documented") cannot pass while we're on Free. There is no budget for the Pro plan right now, which makes this Free-tier approach below the actual near-term direction. Also raised: if the project ever paid for Pro and then lapsed for a month or two, Supabase's native Pro backups are lost (not archived) once the project drops back to Free — a reason to keep the external dump process in section 3 running as a baseline even if Pro is adopted later, rather than relying on Pro's own backups alone.

## Requirements (from the PRD)

Pulled from `180_Connect_Complete_PRD.md` so every candidate below is scored against the same fixed list, not argued case-by-case.

| # | Requirement | Source | Plain English |
|---|---|---|---|
| R1 | Daily automated backups | §14.2 | Back up the database every day, not just occasionally. |
| R2 | Recovery point objective ≤ 24h data loss | §14.2 | If we lose data, at most a day's worth should be unrecoverable. |
| R3 | Recovery time objective ≤ 4h | §14.2 | Restoring from backup should take under 4 hours end-to-end. |
| R4 | Documented restore test before launch | §14.2, §15, MVP acceptance journey #13 | We must actually prove a restore works, not just assume it. |
| R5 | Secrets/credentials never in source control, encrypted | §15 | Whatever holds the DB password or storage keys must not leak into git. |
| R6 | Staging and production use separate credentials | §15 | Don't reuse the same access keys/secrets across environments. |
| R7 | Processor records & transfer safeguards maintained for every processor | §15 | Any new third party that stores our data needs a GDPR processor record, and a transfer safeguard if it sits outside the UK/EU. |
| R8 | Retention periods documented; expired data deleted/anonymised | §15 | We must state how long dumps live, and actually delete/expire them rather than keep them forever. |
| R9 | Storage location minimises exposure of personal data | §14.4 (adjacent), §15 | Dumps contain the same personal data as the live database (contacts etc.), so wherever they land must be access-controlled. |

**Note on point-in-time recovery (PITR):** the PRD mentions PITR "where available" (§14.2, and the delivery-cadence table). It is **not** treated as a requirement here (no R-number), because it's a Supabase Pro feature — none of the storage destinations below can add it themselves, so scoring them against it would just mean every option "fails" the same non-applicable check. It's mentioned so it isn't confused for something these solutions are supposed to deliver: PITR is only relevant if/when Q-01 resolves to Pro, at which point it comes from Supabase directly, not from where dumps are stored.

## Recommended Free-tier Workaround

Since Supabase gives us no native backup mechanism on Free, back up manually using the **Supabase CLI**'s logical dump command, on a schedule, to storage outside Supabase itself.

### 1. One-off setup

```bash
npm install -g supabase
supabase login
```

`npm install -g` installs a command globally on your machine (not into this project's `node_modules`), so it's available from any terminal. `supabase login` opens a browser to authenticate the CLI against your Supabase account — same idea as `git`'s credential setup, just for Supabase.

### 2. Taking a manual backup

```bash
supabase db dump --db-url "<connection-string>" -f backup_$(date +%Y%m%d).sql
```

- `--db-url` points at the project's Postgres connection string (**never** commit this — it contains the database password; keep it in `.env.local` or pass it interactively, same rule as any other secret).
- `-f backup_$(date +%Y%m%d).sql` writes the dump to a file named with today's date, e.g. `backup_20260718.sql`. `$(date +%Y%m%d)` is shell command substitution: it runs `date`, formats it as YYYYMMDD, and drops the result into the filename.
- The output is a plain-text SQL file that can recreate the schema and data by being run back through `psql` or `supabase db reset` against an empty database.

### 3. Automating it

A manual step that depends on someone remembering to run it is not a backup strategy. Proposed: a scheduled **GitHub Action** (runs on GitHub's infrastructure, not ours) that:

1. Triggers on a cron schedule (e.g. daily at 03:00 UTC).
2. Checks out the repo, installs the Supabase CLI.
3. Runs `supabase db dump` using the project's connection string, stored as a **GitHub Actions secret** (`SUPABASE_DB_URL`) — never in the workflow file itself.
4. Uploads the resulting `.sql` file as a build artifact, or pushes it to a private, non-public storage location (e.g. a private S3 bucket or a separate private repo) — **not** the main `180Connect` repo, to avoid bloating it with daily binary-ish diffs and to keep production data away from a repo the whole team can clone.
5. Optionally deletes dumps older than a set retention window (e.g. 30 days) to bound storage cost.

This needs an actual owner and a place to land the files decided before it's built — flagging as a follow-up rather than building it speculatively in this PR (this doc is the design/decision, not yet the implementation).

#### Storage destination options

Where step 4 above actually puts the `.sql` dump. Each candidate scored against R1–R9 above.

**Solution A: GitHub Actions build artifact**

| Req | Status | Why |
|---|---|---|
| R1 | ✅ Met | Cron-triggered workflow uploads a fresh artifact daily. |
| R2 | ✅ Met | Daily runs satisfy the 24h RPO. |
| R3 | ⚠️ Partial | Downloading + `psql` restore is quick, but artifacts aren't built for fast retrieval at scale — fine at our current data size, untested at 4h under real load. |
| R4 | ⚠️ Partial | Restore is doable, but no test has been run yet (see restore-process section). |
| R5 | ✅ Met | DB URL stored as a GitHub Actions secret, never in the workflow file. |
| R6 | ✅ Met | Separate secrets can be scoped per environment. |
| R7 | ⚠️ Partial | GitHub is already a processor for code; using it for data dumps too isn't a *new* processor, but the existing processor record needs updating to say so — not yet done. |
| R8 | ⚠️ Partial | Artifacts auto-expire (default 90 days, configurable), but no explicit retention decision has been recorded. |
| R9 | ⚠️ Partial | Private-repo artifacts are restricted to repo collaborators, which is broader than "people who need backup access" — no extra access control layer. |

**Bottom line:** cheapest and fastest to stand up; good for proving the automation works end-to-end, weakest on access control and retention discipline.

**Solution B: Private GitHub repo (separate from `180Connect`)**

| Req | Status | Why |
|---|---|---|
| R1 | ✅ Met | Same cron-triggered push, committed instead of uploaded. |
| R2 | ✅ Met | Daily commits satisfy the 24h RPO. |
| R3 | ✅ Met | `git clone`/`git pull` + `psql` is a fast, ordinary retrieval path. |
| R4 | ⚠️ Partial | Restore is doable, not yet tested. |
| R5 | ✅ Met | Same secret handling as Solution A. |
| R6 | ✅ Met | Same as Solution A. |
| R7 | ⚠️ Partial | Same reasoning as Solution A — still GitHub, still needs the processor record updated. |
| R8 | ❌ Not met | Git history keeps every commit forever by default; pruning old dumps needs a manual/scripted step that doesn't exist yet. |
| R9 | ⚠️ Partial | Same collaborator-access caveat as Solution A. |

**Bottom line:** marginally better restore ergonomics than an artifact, but worse on retention — nothing expires automatically.

**Solution C: Cloudflare R2**

| Req | Status | Why |
|---|---|---|
| R1 | ✅ Met | Workflow uploads to a bucket daily via the Cloudflare API. |
| R2 | ✅ Met | Daily uploads satisfy the 24h RPO. |
| R3 | ✅ Met | Object storage retrieval is fast regardless of scale. |
| R4 | ⚠️ Partial | Doable, not yet tested. |
| R5 | ✅ Met | API token stored as a GitHub secret. |
| R6 | ✅ Met | Separate buckets or key-prefixes per environment. |
| R7 | ❌ Not met | Cloudflare would be a *new* processor — no processor record or transfer-safeguard assessment exists yet. R2 buckets can be pinned to an EU region, which would make that assessment easier, but it hasn't been done. |
| R8 | ✅ Met | R2 supports lifecycle rules that auto-delete objects past a set age — retention can be enforced, not just documented. |
| R9 | ✅ Met | Buckets are private by default, encrypted at rest, and access is scoped to an API token rather than repo collaborators. |

**Bottom line:** best-scoring option once R7 is done — it's the only one that meets R8 (enforced retention) and R9 (tight access control) without extra work, at the cost of being a new GDPR processor to document first.

**Solution D: Backblaze B2**

| Req | Status | Why |
|---|---|---|
| R1–R6 | ✅ Met | Same shape as Solution C — daily upload, fast retrieval, secrets as a GitHub secret, separate buckets per environment. |
| R7 | ❌ Not met | Also a new processor requiring a record and transfer-safeguard assessment — same gap as R2, no advantage over it here. |
| R8 | ✅ Met | Lifecycle rules supported, same as R2. |
| R9 | ✅ Met | Private buckets, application-key scoped access. |

**Bottom line:** functionally equivalent to Solution C with no clear edge over it, and a small egress cost beyond the free allowance where R2 has none — no reason to prefer it over Solution C.

**Solution E: AWS S3**

| Req | Status | Why |
|---|---|---|
| R1 | ✅ Met | Same daily-upload shape. |
| R2 | ✅ Met | Daily uploads satisfy the 24h RPO. |
| R3 | ✅ Met | Fast retrieval regardless of scale. |
| R4 | ⚠️ Partial | Doable, not yet tested. |
| R5 | ✅ Met | IAM access keys stored as a GitHub secret. |
| R6 | ✅ Met | Separate buckets/IAM roles per environment. |
| R7 | ❌ Not met | A new processor, and — being a US-headquartered provider — the transfer-safeguard assessment carries more scrutiny than Cloudflare or Backblaze even with an EU region selected. |
| R8 | ✅ Met | S3 lifecycle rules support auto-expiry. |
| R9 | ⚠️ Partial | Achievable with SSE encryption and least-privilege IAM, but S3's IAM model is the fiddliest of these to configure correctly — more room to get access control wrong. |

**Bottom line:** no requirement it meets that Solution C doesn't, more setup risk on R9, and only worth it if the team already has an AWS account in active use elsewhere (it doesn't).


**Solution F: Vercel Blob storage**

| Req | Status | Why |
|---|---|---|
| R1 | Met | Workflow uploads to a Blob store daily via Vercel's API. |
| R2 | Met | Daily uploads satisfy the 24h RPO. |
| R3 | Met | Object storage retrieval is fast regardless of scale. |
| R4 | Partial | Doable, not yet tested. |
| R5 | Met | Vercel API token stored as a GitHub secret. |
| R6 | Met | Separate stores/paths per environment. |
| R7 | Partial | Vercel is already a processor for this project (it hosts the app). Adding Blob storage extends what we use them for rather than starting a new vendor relationship from zero — the existing processor-record entry needs a line added for "backup dumps" as a new data category, instead of a brand-new DPA being sought from scratch. Lighter lift than Solutions C/D/E, but still not done yet. |
| R8 | Partial | Vercel Blob supports deleting objects programmatically, but has no R2/S3-style automatic lifecycle expiry — the workflow would need to do the pruning itself. |
| R9 | Met | Private by default; access scoped to the API token. |

**Bottom line:** the strongest option for minimising new GDPR paperwork, since it reuses a processor relationship that already exists rather than creating one. Trade-off: manual retention pruning instead of R2/S3's built-in lifecycle rules.


## Other options considered and set aside
Google Cloud Storage, Wasabi, and iDrive e2 were also looked at. None meaningfully differ from Solutions C-E — all are S3-compatible object storage with a free tier, a new-processor problem, and no structural advantage over Cloudflare R2. Google Cloud Storage is also a separate Google product from the Gmail OAuth scopes already in use, so despite Google already being a listed processor, using it still means documenting a new relationship rather than extending an existing one the way Vercel Blob does.

### 4. Restore process (Free plan)

1. Provision a fresh Supabase project (or use an empty local Postgres instance for a dry run).
2. Restore with:
   ```bash
   psql "<target-db-url>" -f backup_20260718.sql
   ```
3. Verify row counts / spot-check key tables against what's expected.
4. Update any environment variables (`NEXT_PUBLIC_SUPABASE_URL`, etc.) if the restore target is a new project rather than the original.