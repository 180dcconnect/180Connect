# Database Migrations

How 180Connect manages Postgres schema changes. Implements **F232 — Database Migration Management** and **SOP §7 (Database and Schema Changes)**.

> **One source of truth:** the Data Model spreadsheet governs the schema. Every schema change updates the Data Model (table tab **+ tab 02 Data Dictionary**) *before* the migration is written, and follows the order in Data Model tab **"11 Supabase Migration Sequence"**.

## Tooling

Supabase CLI native migrations. Plain SQL under `supabase/migrations/`, applied in filename (timestamp) order.

- **Staging** project: `180connect-staging` (`cgbfhhdeapasniudyyds`)
- **Production** project: `180connect-production` (`tugfhwiqvwrpvawpjwmd`)

## Conventions (SOP §7 — enforced in review)

- Migration files live in `supabase/migrations/`, never edited after they've been applied to a shared environment. Fix-forward with a new migration.
- Table names `UPPER_SNAKE`; field names `lower_snake`.
- Every new table includes `id uuid` primary key (default `gen_random_uuid()`) and `created_at timestamptz not null default now()`.
- **Row-Level Security: enable RLS and add its policies in the same migration that creates the table** (SOP §7). A table is never committed with RLS left off "for later" — that would leave a window where the table is readable by anyone.
  - Sequence step 15 (`enable_rls_policies`, F224) is **retained as a verification pass, not the place RLS is introduced**. By the time it runs, every table should already have RLS on. Step 15 cross-checks that against the Security Controls Register (Data Model tab 12) and catches anything missed.
  - _Decision: Bashir (Project Leader), 21 Jul 2026 — resolves the SOP §7 vs sequence-step-15 wording conflict._
- Never make an untracked manual change to a live database.
- Do not rename or drop a shared field without agreement on the Wednesday call.

## Reversibility (F232 AC3 — no one-way doors)

Supabase migrations are apply-only. Each migration is therefore paired with **one** of:

1. a rollback file at `supabase/rollback/<same-timestamp>_<name>.down.sql` that reverses it, **or**
2. an explicit `-- IRREVERSIBLE: <reason>` header in the migration when reversal is impossible (e.g. a destructive data drop).

The reviewer confirms one of the two exists for every migration.

- **Local rollback:** `supabase db reset` rebuilds the local DB from scratch by replaying all migrations (drops everything first).
- **Staging/prod rollback:** apply the paired `*.down.sql` against the target, then remove the migration from history. Prefer point-in-time recovery (SOP §8) for data-loss incidents.

## Workflows

### Create a migration
```bash
supabase migration new <name>        # e.g. create_organisations
# write forward SQL in supabase/migrations/<ts>_<name>.sql
# write reverse SQL in supabase/rollback/<ts>_<name>.down.sql  (or add -- IRREVERSIBLE header)
```

### Run locally
```bash
supabase start                       # local stack
supabase migration up                # apply pending migrations
# ...verify...
supabase db reset                    # full rebuild (tests migrations from clean)
```

### Apply to staging (after review)
```bash
supabase link --project-ref cgbfhhdeapasniudyyds
supabase db push                     # applies pending migrations to staging
```
Production `db push` happens only through the release process, never ad hoc.

### New developer setup
```bash
supabase init      # already committed; skip if supabase/ exists
supabase start     # local stack
supabase migration up   # or `supabase db reset` to replay all
```

## Schema change approval record (SOP §7 — paste into the PR)

| Field | Entry |
| :---- | :---- |
| Story / PR | Linked GitHub issue + PR |
| Affected tables | Every table, view, function or policy changed |
| Migration | Filename + sequence step number |
| Compatibility | Impact on other streams, jobs, dashboards |
| Data migration | Backfill / transformation required |
| Security | RLS policies + service-role behaviour |
| Documentation | Data Model + Data Dictionary updated (Y/N) |
