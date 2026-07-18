# F225 — Database backup and restore strategy

Owner: Ben Phillips. Reviewer: Bashir Bobboi. Relates to open questions **D-01** and **Q-01** in [open-questions.md](open-questions.md) — read those first, they're the accepted-deviation record this doc turns into a working process. Written with Claude, checked and updated by Ben Phillips.

## Current state

The project's Supabase project ("Development") is on the **Free plan**. On Free:

- No automatic backups of any kind.
- No point-in-time recovery (PITR) — not available at any price below Pro.
- Free projects also pause automatically after a period of inactivity.

This is already recorded as an accepted PRD deviation (D-01): the PRD (§16.3 step 17) requires daily backups and PITR, and MVP acceptance journey #13 ("backup restore is demonstrated and documented") cannot pass while we're on Free. **Q-01 (which Supabase plan the project ultimately runs on) is still an open decision owned by the Project Leader.** This document does not resolve Q-01 — it gives us a working backup process for as long as we're on Free, and notes what changes if/when we move to Pro.

## Recommended interim approach (Free plan)

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

### 4. Restore process (Free plan)

1. Provision a fresh Supabase project (or use an empty local Postgres instance for a dry run).
2. Restore with:
   ```bash
   psql "<target-db-url>" -f backup_20260718.sql
   ```
3. Verify row counts / spot-check key tables against what's expected.
4. Update any environment variables (`NEXT_PUBLIC_SUPABASE_URL`, etc.) if the restore target is a new project rather than the original.

This should be **tested at least once before real organisation data is loaded** (per D-01's "decide by" note) — a backup process nobody has ever restored from is unverified, not working.

## If the project moves to Supabase Pro

Native daily backups (7-day retention) become available automatically, with an optional PITR add-on for second-level granularity. In that case:

- The manual/GitHub Actions dump process above becomes a belt-and-braces extra, not the primary mechanism — Supabase's own dashboard restore is simpler and should be preferred for routine restores.
- This document should be updated to describe the dashboard-based restore flow (project → Database → Backups → select a backup → restore) and to record the new retention window.

## Open items for Bashir / Project Leader

- **Q-01 is the real blocker**: until Free vs. Pro is decided, we're building the free-tier path by default since that's the current state. If Pro is confirmed, the GitHub Actions automation in section 3 may not be needed at all.
- Who owns the scheduled backup job once built (needs a place to run and a place to store dumps — not yet decided).
- Confirm acceptance journey #13 is either satisfied by this interim process or formally descoped, per D-01.
