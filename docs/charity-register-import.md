# Charity Commission imports

How charities get from the regulator's register into the client list, and where
the decisions about *which* charities live.

This document is the design and the reasoning. If you want to *run* an import —
what the screen does, what the filters mean, how to refresh the register — read
[`charity-import-guide.md`](charity-import-guide.md) instead. It is written for
CAMs and admins rather than for developers.

## The shape

Three steps, deliberately separated, because they change at wildly different
rates.

```
  publicextract.*.zip        register.sqlite              organisations
  (regulator, daily)   ──►   (file, ships with     ──►    (client list,
                       [1]    the deployment)        [2]   in Postgres)
```

**[1] Build — the GitHub Action, not a person.**
`.github/workflows/refresh-charity-register.yml` runs monthly, and on demand
from the **Refresh register** button on the import screen. It downloads the
day's bulk extracts and writes *every registered charity in England and Wales*
— 171,800 of them, with their filed annual returns — into a single read-only
SQLite file, published as a GitHub Release asset and pulled into the deployment
at build time (`scripts/fetch-register.mts`, wired as `prebuild`).

Nobody on the team runs a command. `npm run register:build` exists for CI and
for debugging, and is not part of anyone's workflow.

This step applies **no selection criteria at all**. That is the rule the design
exists to protect. The only rows it drops are linked subsidiary entries, which
share a registered number with their parent and would otherwise become duplicate
organisations — a definition of what a charity *is*, not a judgement about which
ones we want.

**[2] Choose and import — `/admin/charity-commission`.** Every criterion is a
query over that file, built on screen, with a live count (~100–200ms, measured). The selection
is copied into `raw_source_records` in the payload shape the existing
`charity_commission_bulk` promote path already reads, and that path — unchanged —
standardises, applies the client-criteria check, detects duplicates and writes
the financial periods.

## Why it is built this way

The previous version filtered *inside* the streaming download. An income floor,
a five-item sector whitelist and four hardcoded place names lived in
`charity-commission-bulk-config.ts`; a charity that failed any of them was
dropped before anything was stored. Changing the criteria meant a pull request,
and the admin page could only ever be a window onto a decision already taken.

Measured against the 2026-09-03 extract, those constants were also wrong for this
organisation:

| Criterion | Effect |
| --- | --- |
| `MIN_INCOME = 100_000` | Excluded 3,229 of the 4,340 charities local to the branch, including all 238 that publish no income figure |
| 5 of 17 `What` classifications | Arts, heritage, environment, religion, sport and 7 more could not be imported at all |
| 4 lowercased place names | The register spells it `Sheffield City`; the code matched `sheffield`, so the clause **never matched Sheffield**, hiding 127 charities |

180DC Sheffield is a student consultancy that works pro bono. An income floor is
close to the opposite of what it needs.

Separating the expensive step (≈1.8GB of parsing, changes daily) from the
selective one (changes constantly) is what makes the criteria editable at all.

### And why the register is a file, not a table

Staged in Postgres the register cost **570MB** against a 500MB free tier, with
the application itself using 45MB. It is a cache of a public file that rebuilds
in twelve minutes; sent emails and replies are not. Spending the storage budget
on the regenerable half while squeezing the irreplaceable half is the wrong
trade at any size — at ~90MB of outreach data per cycle it was the difference
between roughly six months of runway and roughly two years.

Third-party alternatives were checked and neither works (2026-09-03):
**CharityBase**'s API authenticates but its backing index is gone
(`index_not_found_exception: charity_base_2025_03_charity`), and **Find That
Charity**'s list endpoint filters only on `organisationType`, `org_id` and
`active` — no income, cause or location. The Commission publishes files, not a
queryable service, so something has to hold and index the data locally.

## What can be filtered

Everything the register publishes, not a curated subset:

- **Income** — a range, with an explicit switch for charities whose income the
  register does not publish. Null income means *not published*, never zero and
  never "small"; treating it as small is what hid 238 local charities.
- **Classifications** — all three of the register's dimensions:
  17 "what the charity does", 7 "who it helps", 10 "how it works". The last two
  were never filterable before.
- **Location** — any of the register's 174 local authorities, its 4 regions, or
  any postcode area. Postcode area and declared area of operation combine with
  OR by default: a charity based here that never filled in its area of operation
  is still on the doorstep, and one that names Sheffield while registered to a
  London accountant is still working here.
- **Registration dates** — any range, past or recent.
- **Filed accounts, charity type, solvency, name.**

An empty selection means "do not filter on this", never "match nothing". The
screen opens on the whole register.

## Saved filter sets

`import_filter_presets` stores a named filter set — "Sheffield arts, any size" —
so a selection is something the team keeps and re-runs. Re-running is safe:
imports are idempotent by checksum, and a charity already on the list is matched
rather than duplicated.

Identity is `(source, name_key)`, where `name_key` is a stored generated column
holding `lower(btrim(name))`: saving under a name already in use replaces that
set rather than creating a near-twin beside it, whatever case it was typed in.
The column exists because `ON CONFLICT` cannot target an expression index — the
table originally carried the same rule as `(source, lower(btrim(name)))` and
every save failed with `42P10` until `20260923130000` moved it into a column.

## Who can do it

`client:edit` — CAMs and admins, not viewers. Wider than the rest of `/admin`, by
decision: the whole team shapes and runs imports rather than queueing behind an
admin. The safety is visibility, not scarcity — every import is confirmed against
a live count first, and recorded in `audit_log` with who ran it, the criteria in
plain words, and how many organisations it created.

## Access and personal data

The register file is read by server code only (`sqlite.ts` is `server-only`) and
never served to a browser.`import_filter_presets` has RLS enabled **with no policies** (marked `RLS-EXEMPT`
in the table comment — the CI coverage gate allows this because access is
intentionally locked to service-role only), so no anon or authenticated request
can read it either; every access goes through a Server Action after
`getCurrentActor` has authorised the caller.

The register publishes a correspondence email for ~88% of charities and a phone
for ~99%. The data-handling rules (F246/F247) run **at import**, in
`src/lib/charity-register/import.ts`, not when the file is built: the file is a
local mirror of something the regulator publishes to the world, and the rules
govern what enters *our* store. Running them at import also means the active
policy applies rather than one baked into an artefact built weeks earlier, and
the CI job needs no database credentials at all. The import fails closed — if
the rules cannot be read, nothing is imported.

## What was retired

The weekly API discovery job (`charity_commission_discovery_weekly` and
`/api/cron/charity-commission-import`). It searched the register's API forward
from a registration watermark to find newly registered charities. The daily bulk
extract already contains them, with the contact details discovery was valued for,
so keeping both meant two paths creating the same organisation from two payload
shapes. "Registered since X" is now one filter among many — and unlike discovery,
it can also ask for any period in the past.

The **single-charity lookup by registration number** still uses the API, where
hitting it directly beats waiting for a snapshot refresh.

## Operational notes

- The build takes ~12 minutes in CI and about 20 seconds from already-unzipped
  extracts (`--dir`). It is idempotent: the file is rebuilt from scratch each
  time.
- `ANALYZE` at the end of the build is load-bearing. Without planner statistics
  the location filter's `postcode_area in (...) or exists (label)` took 642ms;
  with them it takes 104ms.
- Labels (classifications and areas) are interned into a `label` table and
  referenced by integer. The register repeats 487 distinct strings across 2.3
  million rows; storing them once is what keeps the file at ~180MB.
- The file is versioned by `meta.schema_version` and checked on open, so a file
  built by an older commit is refused with a clear message rather than answering
  with the wrong shape.

## Getting it running the first time

The workflow only becomes real once it is on the repository's **default branch**,
which here is `dev` — not `main`. GitHub will not fire a `schedule:` from any
other branch, and will not expose a workflow to `workflow_dispatch` until the
file exists on the default one. Until then the Refresh button gets a 404 that
reads like a missing workflow, and the schedule silently never runs.

So the order is:

1. Merge this branch into `dev`. That alone makes the workflow dispatchable and
   starts the monthly schedule.
2. Run it once — **Actions → Refresh charity register → Run workflow** — to
   create the `charity-register` release. Nothing exists to download before this.
3. Redeploy. The build picks the file up automatically via `prebuild`.

Steps 1 and 2 need **no secrets at all**: the build and publish steps use the
`GITHUB_TOKEN` that Actions provides itself. The tokens are for the convenience
layer — the in-app button, the automatic redeploy, and reading the asset once
the repository is private.

## When the repository goes private

Nothing changes, provided `REGISTER_DOWNLOAD_TOKEN` is set before the switch.

`scripts/fetch-register.mts` resolves the release through the REST API
(`/releases/tags/{tag}` then `/releases/assets/{id}` with
`Accept: application/octet-stream`) rather than the plain
`github.com/.../releases/download/...` URL. That plain URL authenticates by
session cookie, so it 404s for a private repository even with a valid token —
and because this script never fails the build, that would have produced green
deployments with the register silently absent. The API path behaves identically
whether the repository is public or private.

The workflow itself needs no change: `actions/checkout` and `gh release` use the
built-in `GITHUB_TOKEN`, which keeps working when the repository is private.

## Known gap

`record_field_source` has a hardcoded source allowlist that does not include
`charity_commission_bulk`, so per-field provenance is **not** recorded for
bulk-imported charities. The insert is best-effort, so the import still succeeds
and only logs. This predates the redesign — the original bulk import hit it too —
and `website` is missing from the same list. Fixing it means adding both values
to the allowlist in `record_field_source` and to the matching `CHECK` constraint
on `field_sources.source`.
