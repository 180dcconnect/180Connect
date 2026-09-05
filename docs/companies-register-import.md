# Companies House imports

How companies get from the registrar's register into the client list, and
where the decisions about *which* companies live.

The twin of the charity register import (`charity-register-import.md`, which
reaches `dev` with the same branch as the screen below): the
same three-step shape (build an unfiltered-as-possible file, ship it with the
deployment, choose on screen), adapted to a register thirty times the size
with no API-shaped categories and no financial figures.

> **Status on `dev` (2026-09-05).** Only step [1] — the monthly build and the
> `companies-register` release — is on this branch. The import screen and the
> query layer under `src/lib/companies-register/` described below still live on
> `feature/app-ui` and arrive when it merges. The build is here first
> deliberately: GitHub will not run a workflow that is not on the default
> branch, so the register file cannot exist until this lands. Until the screen
> arrives, Companies House imports still run through the existing discovery
> cron, which is why this branch does not retire it.

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
read-only SQLite file (~200MB, ~690k rows), published as a GitHub Release
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
- The CI summary prints the file size on every run. If it approaches ~220MB,
  narrow the SIC superset — the screen keeps working, over a smaller shelf.

## What the spike established (2026-09-05, September 2026 file, part 1)

- **CICs are in the file.** `CompanyCategory = "Community Interest
  Company"` (~5.6k/part → ~40k total, matching the known CIC population), so
  no API enrichment is needed at build. It maps to
  `company_type = "community-interest-company"`, which the tier classifier
  learns as Tier B — the file records CICs as a category, not a subtype, and
  inventing an underlying legal form would be fabrication.
- **Category wording is human, not slugs** ("Private Limited Company", two
  guarantee-company wordings, …). 27 distinct wordings, all mapped in
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
  ~203MB extrapolated for all seven parts. Counts answer in single-digit
  milliseconds with `ANALYZE`'d indexes.

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
re-runs safely by checksum. Saved sets live in `import_filter_presets` under
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
