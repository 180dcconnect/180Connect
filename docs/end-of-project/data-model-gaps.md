# Data model vs. database

Found while reviewing PR #543 (the analytics epic: F206, F207, F208, F210,
F212), 6 September 2026. Verified again against `dev` at commit `ea3abff3`.

Migration step **13.0 `create_analytics`**
(`docs/data-model/11-supasbase-migration-sequence.md:25`) names eight tables.
One of them exists.

| Table | In the Data Model | In the database |
| :--- | :--- | :--- |
| AUDIT_LOG | yes | **yes** — `20260723100000_create_audit_log.sql` |
| ERROR_LOG | yes | no |
| API_HEALTH_LOGS | yes | no |
| COST_TRACKING | yes | no |
| INGESTION_SUMMARY | yes | no |
| CAM_ACTIVITY_SUMMARY | yes | no |
| PIPELINE_METRICS | yes | no |
| SECTOR_PERFORMANCE | yes | no |

"No" here means no `create table` in `supabase/migrations/` and no reference
anywhere in `src/` — not "partially built". To re-check:

```bash
grep -rn "cam_activity_summary\|pipeline_metrics\|sector_performance\|error_log\|api_health" supabase/ src/
```

PR #543 computes every figure on `/analytics` and `/admin/analytics` from the
raw tables at request time, so the epic did not need any of them. That is why
this was written down rather than fixed: nothing was blocked.

## Where each item has to be done

Nothing below has been done. The spreadsheet column is the part only you can do
— it is outside the repository, so no PR can carry it.

| Item | Spreadsheet (`~/Downloads/Data Model.xlsx`) | Repository |
| :--- | :--- | :--- |
| 1 — ERROR_LOG / API_HEALTH_LOGS in the DoD | Tabs 08, 02, 11 — but only after the decision | DoD template; possibly a migration |
| 2 — OUTCOMES `occurred_at` | Tabs 07, 02 | Migration + two RPCs + `manager-analytics.ts` |
| 3 — the three rollup tables | Tabs 09, 02, 11 | None — code already derives them |
| 4 — split step 13.0 | Tab 11 | None (the file is generated) |
| 5 — the skipping RLS test | None | `supabase/tests/rls_policies.test.sql`, own PR |
| 6 — paste damage in tab 09 | Tab 09 | None |

After any spreadsheet edit: `npm run export:data-model`, then commit the
regenerated `docs/data-model/*.md`.

---

## 1. Two of the missing tables are named in every ticket's Definition of Done

**What is wrong.** Every issue in the backlog carries these two DoD lines:

> - [ ] Every failure is visible and recorded in ERROR_LOG.
> - [ ] Every new external API call writes to API_HEALTH_LOGS.

Neither table exists, so neither box can be literally ticked by anybody, on any
ticket. #543 ticked the first one on the strength of `reportError()`
(`src/lib/error-logging.ts:366`), which writes a scrubbed structured line to
`console.error` and ships to Sentry when `NEXT_PUBLIC_SENTRY_DSN` is set. That
is a real, durable record that Vercel captures — it is simply not the thing the
DoD names, and nobody reading the ticket can tell which of the two happened.

**Why it was deferred.** It is not an analytics problem and fixing it inside an
analytics PR would have buried it.

**What to do.** `DECISION` — pick one and apply it to the DoD template, not to
individual tickets:

- **Treat Sentry/console as the error sink and drop ERROR_LOG from the model.**
  This is what the codebase already does, deliberately and with a documented
  rationale (`src/lib/error-logging.ts:1-25`). Rewrite the DoD line to
  "Every failure is reported through `reportError`". Then delete ERROR_LOG from
  tab **08 System Analytics** and tab **02 Data Dictionary**, and drop it from
  the step 13.0 row in tab **11 Supasbase Migration Sequence**.
- **Or build ERROR_LOG** and have `reportError` write to it as a third
  transport. Costs a migration, RLS policies, a retention rule, and a decision
  about what happens when the logger's own insert fails — the module currently
  guarantees it never throws, and a database write is the easiest way to break
  that guarantee.

API_HEALTH_LOGS is the same decision but with no existing substitute: nothing in
the ingestion pipeline records per-call API health anywhere today, so if that
line stays in the DoD it needs building rather than reinterpreting.

My recommendation is the first option for ERROR_LOG (it describes what is
already true) and building API_HEALTH_LOGS, because ingestion runs unattended
against four external registers and "was the Charity Commission API healthy
last Tuesday" is a question someone will genuinely ask.

---

## 2. OUTCOMES has no `occurred_at`, so "conversions over time" cannot be honest

**What is wrong.** `public.outcomes` carries only `created_at timestamptz not
null default now()` (`20260804200000_create_outreach_events.sql:111`). The
backfill in `20260907120000_record_conversion_outcome.sql:474` inserts one row
per already-converted client without setting it, so every conversion that
happened before tracking existed carries the timestamp of the moment the
migration ran.

F210's chart on `/admin/analytics` plots conversions per day from those rows. It
therefore shows one tall bar on the migration date that is not a real day's
work, and there is nothing in the row to recover the true date from.

Note that SEND_EVENTS in the same migration already makes exactly this
distinction — `occurred_at timestamptz not null` for when the thing happened,
`created_at ... default now()` for when the row was written
(`20260804200000_create_outreach_events.sql:49,53`). OUTCOMES just missed it.

**Why it was deferred.** #543 could caption the artefact but not fix it; the fix
is a schema change and the epic was explicitly scoped to need none.

**What to do.**

1. Tab **07 Outreach Outcomes**, OUTCOMES block — add a field between
   `recorded_by_user_id` and `created_at`:

   | Field | Type | Description |
   | :--- | :--- | :--- |
   | occurred_at | timestamp | When the outcome actually happened, as distinct from when the row was written. Set by the RPC that records the outcome; backfilled rows carry the date tracking began, not the real date. |

2. Mirror it into tab **02 Data Dictionary** (`07 Outreach Outcomes` /
   `OUTCOMES` rows), then `npm run export:data-model`.

3. In the repo, a migration that:
   - adds `occurred_at timestamptz not null default now()`;
   - backfills existing rows from `created_at`, which is the best available
     estimate and correct for every row written after F143 shipped;
   - sets it explicitly in both writers — `set_outreach_status` and
     `set_outreach_status_bulk` in `20260907120000_record_conversion_outcome.sql`
     — so a future conversion is dated by the event, not the insert;
   - carries an RLS policy review only if the column changes what a role can
     see, which it does not.

   Migration timestamp must be later than every migration already on `dev`
   (`scripts/verify-migration-order.sh` enforces this).

4. Then switch `conversionsOverTime` in `src/lib/admin/manager-analytics.ts` to
   read `occurred_at`, and delete the caption under the chart in
   `src/app/admin/analytics/page.tsx` that currently explains the artefact.

---

## 3. CAM_ACTIVITY_SUMMARY, PIPELINE_METRICS and SECTOR_PERFORMANCE

**Decision: remove all three from the Data Model.** Recorded here rather than
acted on, because it is a change to the spreadsheet.

**Reasoning.** All three are pre-computed rollups of figures that already have a
source of truth in the raw tables. #543 computes every one of them at request
time, the numbers were cross-checked against direct SQL, and nothing in the
codebase has ever written to them. Keeping them means maintaining a second
source of truth for the same numbers, and the failure mode is bad: a stale
rollup does not look broken, it looks like a real dip in someone's performance.
Building them properly means a migration, a scheduled job, RLS policies and a
reconciliation check — a lot of machinery to make an already-correct number
slightly faster to fetch.

**The counter-argument, and the trigger that reverses this.** `/admin/analytics`
reads six tables in full on every request. That is fine for one team and a few
thousand organisations, and it stops being fine at some point. The honest
trigger is measured, not guessed: when that page's server render exceeds roughly
two seconds on staging with production-sized data, a daily snapshot table
becomes the right answer — and PIPELINE_METRICS is the one to build first,
because a dated daily row also solves item 2 for every metric at once, not just
conversions.

Until then, deriving beats storing.

**What to do.** Delete the three blocks from tab **09 CAM Analytics**, delete
their rows from tab **02 Data Dictionary**, and edit the step 13.0 row in tab
**11 Supasbase Migration Sequence** to drop them from its table list. Then
`npm run export:data-model`. See also item 5, which becomes a deletion rather
than a fix once this is done.

---

## 4. Step 13.0 bundles two unrelated things

**What is wrong.** Step 13.0 `create_analytics` covers operational logging
(API_HEALTH_LOGS, INGESTION_SUMMARY, COST_TRACKING, ERROR_LOG, AUDIT_LOG) and
derived analytics (CAM_ACTIVITY_SUMMARY, PIPELINE_METRICS, SECTOR_PERFORMANCE)
in a single row. The logging half is load-bearing for every ticket's DoD
(item 1). The analytics half is recommended for deletion (item 3). Leaving them
in one row means the half that matters never gets scheduled, because the row as
a whole looks like it is waiting on a decision.

**Why it was deferred.** `docs/data-model/11-supasbase-migration-sequence.md` is
a generated file — it cannot be edited in the repo, which is where I could have
made the change. The split has to happen in the spreadsheet.

**What to do.** In tab **11 Supasbase Migration Sequence**, replace the single
13.0 row with two:

| Step | Name | Tables | Depends on | Notes |
| :--- | :--- | :--- | :--- | :--- |
| 13.0 | create_operational_logs | API_HEALTH_LOGS, INGESTION_SUMMARY, COST_TRACKING, ERROR_LOG, AUDIT_LOG | USERS | Tab 08. AUDIT_LOG delivered early via `20260723100000_create_audit_log.sql`; the rest outstanding. Two of these are named in the standard Definition of Done — see item 1. |
| 13.1 | create_analytics | *(per item 3, expected to be empty)* | USERS | Tab 09. Every figure is computed from the raw tables at request time; see `src/lib/cam-analytics.ts` and `src/lib/admin/manager-analytics.ts`. |

Then `npm run export:data-model`.

While in that tab: its name is misspelled ("Supasbase"), which is why the
generated file is `11-supasbase-migration-sequence.md`. Fixing the tab name
renames the file and breaks the four documents that link to it
(`AGENTS.md`, `CLAUDE.md`, `docs/data-model/README.md`, and this file). Worth
doing deliberately, in its own commit, or not at all.

---

## 5. The RLS test hides item 3 rather than reporting it

**What is wrong.** `supabase/tests/rls_policies.test.sql:360` guards its
per-CAM-privacy assertion on the table existing:

```sql
if tests.tables_exist('cam_activity_summary') then
  ...
else
  return next skip(1, 'step 13 create_analytics not yet migrated');
end if;
```

The table does not exist, so the assertion has never run. pgTAP reports a skip,
the suite passes, and CI is green. Combined with the local stack reusing a stale
volume between runs, a skip is indistinguishable from a pass at a glance.

**Why it was deferred, and what "best" turned out to be.** I was asked to just
do the best thing here, and the best thing was to not touch it in PR #543.
`migrations.yml` fires on any change under `supabase/**` pushed to `dev`, and it
does not stop at verifying — it auto-applies to staging. Editing a comment in a
test file would have triggered a migration apply as a side effect of merging an
analytics PR, which is how unrelated staging drift gets blamed on the wrong
change. It belongs in its own PR, where that workflow run is the point.

**What to do.** Once item 3 is decided:

- **If the tables are removed** (the recommendation): delete the whole
  `if tests.tables_exist('cam_activity_summary')` block, lines 359-374. There is
  nothing left to assert, and a skip that can never resolve is worse than no
  test — it reads as coverage that exists.
- **If they are built**: turn the `else` branch into a failure rather than a
  skip, so the gap is visible in CI instead of being reported as a pass.

Either way, audit the rest of the file at the same time. `tables_exist` appears
around fifty times in it, and most uses are harmless — they guard tables that do
exist, so the assertion runs normally. The ones worth finding are the other
guards whose table has never been created, each of which is a coverage claim
that is not true. The two immediate neighbours are worth checking first:
line 338 (`raw_source_records`, skipping as "step 6 create_ingestion") and line
349 (`scoring_weights`, skipping as "step 8 create_model_config"). One pass over
the file, listing which guards can currently resolve, would establish how much
of the RLS suite is actually executing:

```bash
grep -n "tables_exist" supabase/tests/rls_policies.test.sql
```

---

## 6. Tab 09 has paste damage

**What is wrong.** The CAM_ACTIVITY_SUMMARY block in
`docs/data-model/09-cam-analytics.md` lists `week_start`, `orgs_scored`,
`emails_sent`, `replies_received`, `conversions` and `created_at` **twice** —
the second set with empty descriptions — plus eight fields that are documented
nowhere else: `emails_sent_today`, `emails_sent_week`, `emails_sent_month`,
`active_charities`, `ai_recommendations_accepted`, `ai_recommendations_skipped`,
`conversion_rate_sector`, `conversion_rate_geography`.

Tab **02 Data Dictionary** lists only the clean eight fields for the same table.
The two tabs disagree, which means a column block was pasted into tab 09 at some
point and never cleaned up.

**Why it was deferred.** It is a data-entry problem in a file the repo cannot
edit, and it describes a table that item 3 recommends deleting outright.

**What to do.** Moot if item 3 is executed — deleting the block deletes the
damage. If the table is kept instead, remove the duplicated rows and either
document the eight extra fields or delete them, so tabs 09 and 02 agree.

Either way, the useful part is the signal: the same paste error may exist in
other tabs. The generated markdown is the cheapest place to spot it, because a
duplicated field shows up as two rows with the same name and one empty
description:

```bash
# fields listed more than once within a single generated tab file
for f in docs/data-model/*.md; do
  awk -F'|' '/^\| [a-z_]+ \|/ {print FILENAME": "$2}' "$f" | sort | uniq -d
done
```
