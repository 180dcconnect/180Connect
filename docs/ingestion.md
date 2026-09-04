# Data ingestion

How an organisation gets from an external register into the client list, which
sources feed it, and what runs on a schedule.

For the Charity Commission specifically — the filter screen, the register file
and how imports are chosen — see
[`charity-register-import.md`](charity-register-import.md). This document is the
map; that one is the detail for the largest source. For running an import rather
than understanding it, see [`charity-import-guide.md`](charity-import-guide.md).

---

## The four stages

Every source, without exception, moves through the same four stages. The value
of that is narrow but real: a new source has to answer only "how do I fetch?",
because everything after the fetch is already decided and already tested.

```
  [1] ACQUIRE          [2] RAW              [3] STANDARDISE       [4] CLIENT LIST
  an adapter,          raw_source_records   one mapper per        organisations
  or the register  ──► (payload exactly ──► source, into      ──► (+ scores,
  file                  as received)         a common shape         financials,
                                                                    identifiers)
```

### [1] Acquire

Either a `DataSourceAdapter` (`src/lib/ingestion/type.ts`) or, for the Charity
Commission register, a file shipped with the deployment.

An adapter implements exactly three things:

```ts
{
  name: DataSourceName;
  fetch(): Promise<SourceFetchResult>;   // records, truncated, optional stats
  onError(err: Error): void;
}
```

It knows nothing about the database. `runIngestion` (`src/lib/ingestion/runner.ts`)
gives every adapter the same treatment:

- **One `ingestion_runs` row per source per run**, so every fetch is visible on
  `/admin/import-status` whether it was a cron job, an admin button or a script.
- **Checksum deduplication.** A record whose payload hashes to what is already
  stored is skipped. Re-running an import is therefore cheap and safe, which is
  what makes "re-run this saved filter set" a reasonable thing to offer.
- **Failure isolation.** Sources run concurrently under `Promise.allSettled`, so
  one source's outage cannot affect another's run.
- **`truncated` → `partial`.** A source that hit its own result ceiling records a
  partial run rather than a completed one that quietly found less.

### [2] Raw

`raw_source_records` holds the payload **exactly as received**, keyed on
`(record_source, source_record_id)`. Nothing is interpreted here.

This is the layer that makes provenance answerable: every field on an
organisation can be traced back to the record it came from, and re-standardising
after a mapper bug is a re-read rather than a re-fetch.

**Data handling (F246/F247) applies on the way in.** `applyDataHandling` strips
denied fields and redacts personal email addresses and phone numbers *before* the
payload is checksummed and written, and each row records which fields were
removed under which rule version. Clearing before the checksum is deliberate:
the stored checksum describes what was actually stored, so tightening a rule
correctly re-imports a record rather than skipping it as unchanged.

The runner **fails closed**. If the rules cannot be read, no source runs at all —
better to import nothing than to store a home address.

### [3] Standardise

One mapper per source in `src/lib/standardize/`, each turning that source's
payload into a `StandardOrganisation`. Mappers are pure and separately tested.

They are deliberately **not** shared between sources. The Charity Commission API
returns `address_line_one`; its bulk extract returns `charity_contact_address1`.
One mapper reading both would be a pile of `??` chains where nobody can tell
which source a value came from — and that is exactly how a field silently stops
being populated when a source changes shape.

### [4] Promote to the client list

`promotePending*Records` in `src/lib/standardize/write-organisations.ts` does the
work that is common to every source:

| Step | What it does |
| --- | --- |
| Usability check | No usable name → recorded as invalid, not written |
| Client criteria (F047) | `checkClientCriteria` decides accepted / needs review / does not meet |
| Duplicate detection (F042) | Matches on registration number and name+postcode; a match is flagged, not merged |
| Write | Inserts the organisation and links it back to the raw record |
| Annotate | Field provenance, identifiers, sector, financial periods — all best-effort |

"Best-effort" is load-bearing: the organisation is already committed by then, so
a failed annotation is reported and does not roll back a good import.

---

## The sources

| Source | Status | How it runs |
| --- | --- | --- |
| `charity_commission_bulk` | **Primary.** Whole register of England & Wales | Filter and import on `/admin/charity-commission`, over a file shipped with the deployment |
| `charity_commission` | Single-charity lookup only | By registration number, on the same page |
| `companies_house` | Active | Weekly discovery cron + status recheck; `/admin/companies-house` |
| `360giving` | Active | Enrichment only. A background queue works through the client list (`three_sixty_giving_backfill`); a button on each client record fetches one on demand |
| `find_that_charity` | Enrichment only | Name reconciliation against records already held. No bulk endpoint exists |
| `website` | Manual | F037's URL import, one page at a time |
| `charitybase` | **Not implemented** | Their API authenticates but its backing index is gone (checked 2026-09-03) |
| `globalgiving`, `candid` | **Not implemented** | Reserved in `data_source_name`; no adapter |

`DATA_SOURCES` in `src/lib/ingestion/type.ts` is the single list, matched by the
`public.data_source_name` domain. Adding a source is one line in each.

---

## What runs on a schedule

pg_cron calls Vercel routes under `/api/cron/*`, each guarded by `CRON_SECRET`.

| Job | When | What |
| --- | --- | --- |
| `companies_house_discovery_weekly` | Mon 02:00 | New company registrations |
| `charity_commission_status_recheck_weekly` | Fri 02:00 | Charities removed from the register |
| `companies_house_status_recheck_weekly` | Thu 02:00 | Companies dissolved or struck off |
| `charity_commission_financial_refresh_weekly` | Wed 03:00 | Refreshes filed accounts per charity |
| `provenance_audit_daily` | 04:41 | Checks field provenance is intact |
| `gmail_reply_sync` | every 5 min | Captures replies to outreach |
| `scheduled_outreach_delivery` | every 5 min | Sends queued outreach |
| `stall_detection_daily` | 04:17 | Flags stalled conversations |
| `three_sixty_giving_backfill` | every 15 min | Asks 360Giving about the next slice of organisations |

Separately, a **GitHub Action** rebuilds the charity register file monthly — see
[`charity-register-import.md`](charity-register-import.md). It is the only
ingestion job that does not run through pg_cron, because reading ~1.8GB of
extracts will not fit in a serverless function.

---

## Where things live

```
src/lib/ingestion/
  type.ts               the adapter contract and DATA_SOURCES
  runner.ts             run bookkeeping, dedup, failure isolation
  store.ts              the only file that talks PostgREST
  apply-data-handling.ts  F246/F247 redaction
  checksum.ts           payload hashing
  sources/              one adapter per source

src/lib/charity-register/
  filters.ts            what can be asked of the register
  sqlite-query.ts       filters → SQL
  sqlite.ts             opens the register file (server-only)
  import.ts             selection → raw_source_records
  extract-stream.ts     streaming reader for the regulator's zips

src/lib/standardize/
  <source>.ts           one mapper per source
  write-organisations.ts  promotion, criteria, duplicates, annotation
```

---

## Reading a run

`/admin/import-status` lists every run, newest first, with each one stated as a
sentence rather than a row of counts. The vocabulary:

- **Found** — records the source returned
- **Added** — written as new, or rewritten because the payload changed
- **Already held** — identical to what was stored, so skipped by checksum
- **Unusable** — rejected before the database (no usable id or name)
- **Flagged** — matched an organisation already on the list

A run with everything at zero is a normal weekly outcome, not a fault.

---

## Adding a source

1. Add the name to `DATA_SOURCES` (`src/lib/ingestion/type.ts`) and to the
   `public.data_source_name` domain in a migration. Both, or dedup keys and the
   type will disagree.
2. Write the adapter in `src/lib/ingestion/sources/`. Fetch only — no database.
3. Write the mapper in `src/lib/standardize/`. Pure, with its own tests.
4. Add a `promotePending*Records` path, or reuse one if the payload shape matches.
5. Add the source to `FIELD_SOURCES.source`'s allowlist — **in both places**: the
   CHECK constraint and the list inside `record_field_source()`. Missing this is
   why bulk-imported charities recorded no provenance for weeks: the write is
   best-effort, so it failed silently.
6. Add a label to `SOURCE_LABELS` in `src/app/admin/import-status/run-format.ts`,
   or the source shows on screen as a raw token.

---

## Retired

**Charity Commission API discovery** (`charity_commission_discovery_weekly`,
`/api/cron/charity-commission-import`), removed 2026-09-03. It searched the
register's API forward from a registration watermark for newly registered
charities. The daily bulk extract already contains them, with the contact
details discovery was valued for — 88% have an email, 99% a phone — so keeping
both meant two paths creating the same organisation from two payload shapes on
two cadences. "Registered since X" is now one filter among many, and unlike
discovery it can also ask for any period in the past.

Two things about it are worth remembering, because both were invisible:

- It applied **no locality filter**, importing 100–300 charities a week from
  anywhere in England and Wales.
- Its `charityCommissionAdapter` sibling — a fixed date-range backfill — carried
  a documented TODO that a wide range would exceed the serverless timeout.

Both are the same failure: a decision buried where nobody using the product
could see it. That is the standard the current design is trying to hold to.
