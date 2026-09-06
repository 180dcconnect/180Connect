# Companies House imports

How companies get from the registrar's register into the client list, and
where the decisions about *which* companies live.

The twin of [`charity-register-import.md`](charity-register-import.md): the
same three-step shape (build an unfiltered-as-possible file, ship it with the
deployment, choose on screen), adapted to a register thirty times the size
with no API-shaped categories and no financial figures.

## The shape

```
BasicCompanyDataAsOneFile-YYYY-MM-01.zip   companies-register.sqlite      organisations
(regulator, monthly, ~5.2M rows)     ──►   (file, ships with        ──►    (client list,
                                  [1]      the deployment)           [2]   in Postgres)
```

**[1] Build — the GitHub Action, not a person.**
`.github/workflows/refresh-companies-register.yml` runs monthly on the 8th
(the snapshot compiles to month end and lands within 5 working days, so the
8th always has a complete file), and on demand with an optional month
override. It downloads the month's part ZIPs, keeps every mission-plausible
company — Tier A legal forms, CICs, Tier C legal forms, and any company whose
SIC intersects the build-time superset — and writes them into a single
read-only SQLite file (213MB, 723,670 rows), published as a GitHub Release
asset and pulled into the deployment at build time
(`scripts/fetch-companies-register.mts`, wired as `prebuild` alongside the
charity fetch).

**[2] Choose and import — `/admin/companies-house`.** Every
criterion is a query over that file, built on screen, with a live count. The
selection is copied into `raw_source_records` in the payload shape the
existing `companies_house` promote path already reads, and that path —
unchanged — standardises, applies the client-criteria check (with the Tier
A/B strong-evidence bypass), detects duplicates and writes the identifiers.

## Why filtered, when the charity file is whole

The charity build stores all 171,800 charities (182MB) and applies no
selection criteria at all. The equivalent for companies would be ~1GB —
unshippable inside the deployment. So the build keeps ~12% of the register
and the screen chooses within it. The compromise is bounded and visible:

- The build-time rule (`isCoveredCompany`) is deliberately *wider* than any
  import the team would run: whole legal-form classes plus a SIC superset
  equal to today's allowlist. A team SIC change inside the superset is a UI
  preset, not a rebuild.
- `meta` records what the build kept (`companies`, `sic_links`,
  `sic_superset_count`) and what it could not map (`unmapped_categories`).
- The CI summary prints the file size on every run. The September 2026 build
  came in at 213MB — 5% over the 203MB the one-part trial extrapolated, because
  it kept 723,670 companies rather than the projected ~690k. The old ~220MB
  ceiling was written when a large file in the deployment was the worry; Vercel
  now allows far more, and 213MB beside the charity file's 179MB is
  comfortable. Watch the *trend* rather than the threshold: the register grows
  every month, and narrowing the SIC superset is the lever if a build ever
  starts costing more than it returns.

## What the first full build established (2026-09-05, September 2026 file)

Run [33969995590](https://github.com/180dcconnect/180Connect/actions/runs/33969995590),
all seven parts, 2m 15s of build inside a 3m 4s job — the "about twenty
minutes" in the original estimate was pessimistic by an order of magnitude.

| | |
| --- | --- |
| Scanned | 5,689,368 |
| Kept | 723,670 (12.7%) |
| SIC links | 1,057,937 |
| Distinct SIC codes (`sic_label`) | 720 |
| SIC superset size | 58 codes |
| Duplicate company numbers replaced | 0 |
| Unmapped categories | **none** |
| File | 213.1MB |

`unmapped: none` is the one worth noting: `CATEGORY_TO_SLUG` covered every
`CompanyCategory` wording in the whole register, not just the part-1 sample,
and `cat_slug = 'other'` holds zero rows. Nothing degraded to review-routing.

What the file actually contains, by legal form:

| `cat_slug` | Companies |
| --- | --- |
| `ltd` | 574,267 |
| `community-interest-company` | 44,829 |
| `charitable-incorporated-organisation` | 40,416 |
| `private-limited-guarant-nsc` | 31,017 |
| `private-limited-guarant-nsc-limited-exemption` | 23,559 |
| `scottish-charitable-incorporated-organisation` | 7,923 |
| `royal-charter` | 909 |
| `private-unlimited` | 462 |
| `plc` | 255 |
| `private-unlimited-nsc`, `private-limited-shares-section-30-exemption`, `united-kingdom-societas` | 33 combined |

By normalised status: 716,282 active, 6,929 liquidation, 330 administration,
105 voluntary-arrangement, 24 receivership.

## What the spike established (2026-09-05, September 2026 file, part 1)

- **CICs are in the file.** `CompanyCategory = "Community Interest
  Company"` (~5.6k/part → 44,829 in the full build, matching the known CIC
  population), so
  no API enrichment is needed at build. It maps to
  `company_type = "community-interest-company"`, which the tier classifier
  learns as Tier B — the file records CICs as a category, not a subtype, and
  inventing an underlying legal form would be fabrication.
- **Category wording is human, not slugs** ("Private Limited Company", two
  guarantee-company wordings, …). 26 distinct wordings, all mapped in
  `CATEGORY_TO_SLUG` and pinned by test. An unmapped wording stores as
  `"other"` (review-routed, never auto-added), is counted loudly, and is
  recoverable — the mapping is the only thing that needs updating.
- **Statuses include transitional states** (`Active - Proposal to Strike
  off`, `Liquidation`, …). The build normalises to the API vocabulary at
  write time, so the first status-recheck after an import never false-fires.
- **SIC text is combined** (`"86101 - Hospital activities"`) with legacy
  4-digit SIC2003 codes and `None Supplied` mixed in. Only 5-digit SIC2007
  codes are stored or matched — the same vocabulary the API speaks.
- **No contacts, no figures.** The product carries neither, so F246/F247 is a
  (still enforced, still fail-closed) no-op and imported companies arrive
  with blank websites and no financial periods.
- **Further-education corporations have no distinct wording** — they hide
  inside "Other company type" and are reachable only via SIC, same as any
  ordinary company.
- Trial build from one part: 98,630 kept of 849,999 scanned, 29.0MB →
  ~203MB extrapolated for all seven parts (the real build came in at 213MB).
  The "counts answer in single-digit milliseconds" this measured did **not**
  survive the full file — see below.

## The file

`src/lib/companies-register/sqlite-schema.ts` is the contract; the build
script and the reader must agree with it, and `meta.schema_version` refuses
a stale file with a clear message rather than wrong counts.

- `company` — one row per kept company: number, name, type slug, raw +
  normalised status, incorporation date, postcode + area, town, street
  address, CIC flag. No county (empty in two-thirds of rows; town and
  postcode area cover location), no URI (derivable from the number).
- `company_sic` — normalised SIC links, every 5-digit code the company
  carries, not just allowlisted ones, so the picker can widen within the
  file without a rebuild.
- `sic_label` — one row per distinct code with the file's own description
  (first-seen wins; bare codes fall back to the code). The picker's labels
  are the register's wording, not ours.
- `meta` — build provenance: date, snapshot month, counts, unmapped list,
  schema version.

## Query layer (`src/lib/companies-register/`)

| Module | Twin | Notes |
| --- | --- | --- |
| `filters.ts` | charity `filters.ts` | Names, town, types, SIC, CIC-only, postcode areas, incorporation window, statuses (live default, visible control). No income bounds — the product publishes none. |
| `sqlite-query.ts` | charity `sqlite-query.ts` | SIC via `exists` over `company_sic` (a company with two selected codes appears once). Selection ordered by company number for stable capped imports. |
| `sqlite.ts` | charity `sqlite.ts` | `server-only`, version-checked open, `COMPANIES_REGISTER_DB_PATH` override. |
| `import.ts` | charity `import.ts` | Rebuilds API-shaped payloads (the standardiser keeps one vocabulary), checksum-idempotent, `record_source = "companies_house"`. |
| `vocabulary.ts` | charity `vocabulary.ts` | 21 SIC sections for grouping, type/status labels. SIC titles come from the file, not from code. |
| `csv-row.ts` | charity `extract-rows.ts` | File vocabulary + streaming RFC 4180 reader (quoted commas, embedded newlines, chunk-split CRLF). |

## Counting speed, and the one thing the spike got wrong

The part-1 trial measured filtered counts in single-digit milliseconds. On the
full 723,670-row file the SIC filter did not hold that at all — three codes
plus the live-status default took **909ms**, and the screen recounts on every
filter change, so that is a visible stall rather than a live number.

The cause was the shape of the subquery, not a missing index. Written as a
correlated `exists (select 1 from company_sic s where s.number = c.number …)`
— which reads naturally, and is what the charity twin does — SQLite drives
from `company`, walks all 716k live rows, and probes `company_sic_by_company`
once per row. It never touches `company_sic_by_sic`, the index built precisely
for this question. Written as `c.number in (select s.number from company_sic s
where s.sic in (…))` it reads only the rows carrying the selected codes and
probes `company` by primary key:

```
exists →  SEARCH c USING INDEX company_status_norm (status_norm=?)
          SEARCH s EXISTS USING COVERING INDEX company_sic_by_company
in     →  LIST SUBQUERY 1
          SEARCH s USING COVERING INDEX company_sic_by_sic (sic=?)
          SEARCH c USING sqlite_autoindex_company_1 (number=?)
```

Both are semi-joins, so both still answer once for a company carrying two
selected codes — the dedup guarantee the `exists` was chosen for is not lost.
Measured on the September 2026 file:

| Filter | Before | After | Result |
| --- | --- | --- | --- |
| 3 SIC codes + live | 909ms | **60ms** | 44,883 |
| 8 SIC codes + live | — | 307ms | 220,424 |
| 3 SIC codes + postcode area | — | 84ms | 667 |
| CICs only + live | — | 49ms | 44,659 |
| Unfiltered (live default) | — | 16ms | 716,282 |

A regression test pins the clause shape, because the tempting "simplification"
is to put the correlated `exists` back. Eight codes at 307ms is the current
worst case and is acceptable; if the picker ever grows multi-section presets
that select dozens of codes at once, this is the number to re-measure.

The charity twin carries the same `exists` shape over a table a quarter the
size, so it has not bitten — but it is the same latent issue, and worth
checking before that file grows.

## Single-company lookup and status recheck

Unchanged: both hit the live API, where hitting it directly beats waiting
for a snapshot refresh. The lookup (`createCompaniesHouseAdapter`) and the
Thursday status watch (`runCompaniesHouseStatusRecheck`, 400
least-recently-checked) keep working on API-shaped payloads side by side
with file-sourced rows — the mapper reads the intersection both shapes
guarantee.

## The screen (`/admin/companies-house`)

The twin of the charity screen: run history as the landing view, the composer
entered from it, a rail showing staged size / snapshot month / refresh, and
the single-company lookup as its own card below. `client:edit` throughout —
CAMs and admins, not viewers — with refresh itself gated on
`platform-settings:manage`, exactly the split the charity screen draws.

Filters are the file's own vocabulary: names, town, company types, SIC codes
(searched, grouped by SIC section, each with its staged count), CIC-only,
postcode areas, incorporation window, and statuses defaulting visibly to live
only. Import confirms against the live count in plain words, caps at 10,000,
records `companies_register_imported` in the audit log with who ran it, and
re-runs safely by checksum. A selection larger than the cap is imported in
company-number order and the run is recorded as `partial`, with the
confirmation, the result message and `run_stats` all saying so — the cap is
applied inside `selectCompanies`, so every count downstream of it reports the
capped number and cannot be used to detect truncation. The pre-cap
`countCompanies` is the only number that knows. Saved sets live in `import_filter_presets` under
`source = "companies_house"` — no migration needed, the column is
unconstrained text.

## What was retired

The discovery adapter (`createCompaniesHouseDiscoveryAdapter`), its weekly
cron (`companies_house_discovery_weekly`, unscheduled by
`20260917090000_retire_companies_house_discovery_cron.sql`), the
`/api/cron/companies-house-import` route, the zero-input import button and
the discovery digest email. The tier constants in
`companies-house-criteria-config.ts` stay — reclassified from "discovery
queries" to "the shared tier rule the file build and the promote path both
read", plus the file-sourced CIC category the bulk product forced into
existence.

## What a company says it does

The register gives us two descriptive things about a company, and neither is a
mission statement in the sense the charity side has one.

### SIC codes — `ORGANISATIONS.sic_codes`

The registrar's industry classification, five-digit SIC2007 only. Already
travelled the whole pipeline: `import.ts` writes them into the payload as
`sic_codes`, the live API returns the same field, and the standardiser read them
for F047 tiering and then dropped them. `20260919090000_add_sic_codes.sql` gives
them a column and backfills from the stored payloads, which is required rather
than optional — `flagIfDuplicate` short-circuits a company already on the client
list before the annotate step, so re-importing never fills this in.

Codes are stored; titles are resolved at read time from `sic_label` by
`sicTitles()` in `src/lib/companies-register/sqlite.ts`, so a wording change in a
monthly rebuild reaches every stored row with no data migration. A code the file
does not know — possible via the live single-company lookup, since the build
keeps ~12% of the register — displays as the bare code.

Surfaced as **"Nature of business"** on the client record, never as "Mission".
It says which drawer a company was filed in: 118 of the 413 companies imported
so far share `85590 Other education n.e.c.`, and 208 carry exactly one code. It
fills the field; it does not tell two CICs apart.

### The CIC36 community interest statement — `ORGANISATIONS.cic_community_statement`

Every Community Interest Company files a CIC36 at incorporation: Section A names
the community it intends to benefit, Section B describes its day-to-day
activities. It is the company's own filed account of its purpose, approved by the
CIC Regulator, and it is the real counterpart of a charity's
`charity_activities`.

Companies House publishes no structured field for it. It exists only inside the
incorporation filing (type `CICINC`), and in every filing sampled the CIC36 pages
are **images** — the first 9–14 pages of the document carry a text layer and the
CIC36 is not among them. So `src/lib/cic-statement/` fetches the filing, pulls
the page bitmaps, and transcribes them.

| Module | Job |
| --- | --- |
| `filing.ts` | Find the `CICINC` filing, follow `links.document_metadata`, fetch the PDF. Never written to disk. |
| `page-images.ts` | Pull the full-page image XObjects via pdf.js and wrap them as PNG. **No rasteriser** — each scanned page is already a single edge-to-edge bitmap, so there is nothing to render and no native dependency to install. |
| `ocr.ts` | `tesseract.js` (WASM), returning text *and* word boxes. |
| `extract-statement.ts` | Pure. Locates the CIC36 and pulls the two boxes out. Everything that can be wrong lives here, which is why it is the part with fixture tests. |
| `backfill.ts` | Target finding and a capped runner, modelled on the charity register's `profile-backfill.ts`. |

Things worth knowing before touching it:

- **Word boxes are mandatory, not an optimisation.** Section B is a two-column
  table and Tesseract's reading order walks across both, so its plain text
  interleaves them — `25TH Education & Training CIC | The community will benefit
  through improved education` arrives as one line. The columns are recovered
  geometrically, by finding the gutter each line shares.
- **Position varies.** Form versions 9, 12 and 13 all appeared in a
  five-filing sample, with different layouts and the CIC36 four to six pages from
  the end. Pages are read back-to-front, at most eight of them, and identified by
  content — never by index.
- **The text is usually cut short.** The form's boxes are fixed height and clip
  mid-sentence, with "(Please continue separate sheet if necessary.)" underneath.
  What the page shows is what the public record shows, and it is what we store.
- **Transcription, not generation.** Measured mean word confidence 88–95 across
  samples, including a genuine photocopy. Nothing is inferred: where the scan is
  poor the text is imperfectly transcribed rather than plausibly invented, which
  is the property that lets it sit in a field the Data Model guarantees is filed
  register text.
- **`cic_statement_checked_at` is the queue.** Set on every attempt including
  the ones that find nothing, so the several hundred ordinary companies with no
  CIC36 are not re-fetched for ever. A *transient* failure deliberately leaves it
  null so the company comes round again.
- **Personal data.** A CIC incorporation filing carries director names, dates of
  birth, service addresses and an email address. The PDF is never stored, only
  statement pages are read, only the two boxes are taken, and what survives goes
  through `applyDataHandling` before any write. The residual risk is a director
  naming themselves in their own statement — the NER boundary
  [`personal-data-exclusions.md`](personal-data-exclusions.md) already documents
  and accepts.

### Running it

```bash
npm run tesseract:fetch                       # 5.2MB language model into data/ (wired into prebuild)
npm run backfill:cic-statements -- --dry-run  # report the queue
npm run backfill:cic-statements               # drain it
```

The script is the primary vehicle — roughly five seconds per company, so a few
hundred fit in no serverless invocation. The card on `/admin/companies-house`
runs the same code capped at `MAX_BACKFILL` per press, for topping up after an
import.

Overrides: `TESSERACT_LANG_PATH` (directory holding `eng.traineddata`, default
`data/`), `TESSERACT_ENG_PATH` and `TESSERACT_ENG_URL` for the fetch script.
