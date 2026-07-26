# Seed / Test Data

Fake organisation records for local and staging development, so features can be built
and tested without touching real client data. Implements **F233 — Seed/Test Data**.

```bash
npm run seed
```

## What you get

50 organisations in `public.organisations`:

| Pipeline stage (`outreach_status`) | Records |
| :--- | :--- |
| `not_started` | 10 |
| `queued` | 10 |
| `contacted` | 10 |
| `replied` | 10 |
| `closed` | 10 |

About 30% have deliberately incomplete profiles, spread across every stage and
covering each kind of gap: no email, no website, no address, no email *and* no
website, and records missing all three. The rest are complete.
`data_completeness_score` is computed to match, so it can be filtered and sorted on.

A fifth of the records are non-GB (`is_international = true`), so international
handling has something to exercise.

## The data is fake, not anonymised

Every record is invented. None of it derives from a real organisation. This is a
deliberate choice: anonymised production data still carries the GDPR obligations of
the original records, and the point of this script is that developers never need
real client data at all.

Generation is deterministic — the same 50 records on every machine, every run — so a
bug found against seed data reproduces for everyone.

## Telling seed data apart from real data

Two markers, and the first is the one that counts:

1. **`is_seed = true`** on every seeded row. This is the queryable, deletable marker.

   ```sql
   select count(*) from public.organisations where is_seed;      -- how much seed data
   delete from public.organisations where is_seed;               -- remove all of it
   ```

2. **The reserved `.seed.test` domain** in `website` and `contact_email`, e.g.
   `contact@ashgrove-youth-trust.seed.test`. Useful when reading rows by eye, but it
   cannot be the primary marker — roughly a third of the records have no email or no
   website by design.

Real records always have `is_seed = false` (the column default).

## Safety

The script **refuses to run against production**, checked two independent ways:

- the environment declares itself production (`NODE_ENV`, `VERCEL_ENV`, or
  `SENTRY_ENVIRONMENT` set to `production`), or
- `SUPABASE_DB_URL` points at the production Supabase project
  (`tugfhwiqvwrpvawpjwmd`, `180connect-production`).

Either one stops the run. There is no override flag, on purpose.

The two checks are independent because either alone can be wrong: a local shell has
no `VERCEL_ENV`, and `NODE_ENV` says nothing about which project the URL points at.

## Idempotency and partial state

Re-running is safe. Each run deletes the rows it previously created — matched on
`is_seed`, never on name or row count — and inserts a fresh set. Ten runs leave the
same 50 rows as one.

The delete and the inserts share a single transaction. If anything fails part-way,
the whole run rolls back and the database is left exactly as it was. There is no
state in which half a seed is loaded.

## Setup

1. Apply the migrations first. The script writes to `public.organisations`, created
   by sequence step 3 — see [supabase/MIGRATIONS.md](../supabase/MIGRATIONS.md).

   ```bash
   supabase start && supabase migration up     # local stack
   # or, against a linked project:
   supabase db push
   ```

2. Set `SUPABASE_DB_URL` in `.env.local` — the Postgres connection string for the
   database you want to seed.

   - Local stack: `postgresql://postgres:postgres@127.0.0.1:54322/postgres`
   - Staging: Supabase dashboard → `180connect-staging` → **Connect** → **Session
     pooler** → copy URI.

   **Use the session pooler string** (`aws-1-<region>.pooler.supabase.com:5432`,
   user `postgres.<ref>`). It is IPv4 and works everywhere. The direct string
   (`db.<ref>.supabase.co`) is IPv6-only and fails on most machines; the
   transaction pooler (`:6543`) also works but the session pooler is the safe pick.

3. ```bash
   npm run seed
   ```

To remove the fake data again — before a demo of real data, say:

```bash
npm run seed:clear
```

It deletes every `is_seed = true` row and leaves real data untouched, behind the
same production guards.

## Failure cases

Every failure is loud and says what to do next; none of them fail silently.

| What went wrong | What you see |
| :--- | :--- |
| `SUPABASE_DB_URL` not set | Names the variable, says where to get the value, points at `docs/environment-variables.md`. Exit code 1. |
| Value is not a Postgres URI | Says what shape is expected. Exit code 1. |
| Target is production | Refuses, naming which check tripped. Exit code 1. |
| `public.organisations` does not exist | Tells you to apply migrations, with the commands. Exit code 1. |
| Anything else (connection dropped, constraint violation) | Transaction rolled back, no rows written, error printed **and** sent to the error log (F226). Exit code 1. |

The connection string is never printed. The run banner is built from the host and
project ref only, so the password cannot end up in a terminal log or CI output.

## Where the code lives

| File | What it does |
| :--- | :--- |
| `scripts/seed.mts` | `npm run seed` — connects, runs the transaction, reports |
| `scripts/seed-clear.mts` | `npm run seed:clear` — deletes all `is_seed` rows |
| `src/lib/seed/config.ts` | Environment resolution and the production guards |
| `src/lib/seed/fixtures.ts` | Record generation |
| `src/lib/seed/*.test.ts` | Covered by `npm test` |

The generator is pure and the guards take the environment as an argument, so both are
tested without a database. `npm test` runs them.

## Changing the data

Adding fields or changing the mix is an edit to `src/lib/seed/fixtures.ts`. Two rules:

- Every generated record keeps `is_seed: true`. Without it the row is
  indistinguishable from real data and the next run will not clean it up.
- Generated URLs and email addresses stay under `.seed.test`. It is a reserved TLD,
  so nothing can be accidentally emailed or requested over the network.
