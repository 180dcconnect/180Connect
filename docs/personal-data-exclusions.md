# Personal data exclusions

**Spec:** Technical Brief §5, Data & Legal Risks (1): "if APIs can return private
information such name of trustees, personal email addresses, which shall not be
stored or used in any way or form."

**Enforced by:** `supabase/migrations/20260818100200_create_data_handling_rules.sql`
(F246, field-level deny-list) and `20260818100400_add_personal_data_exclusion.sql`
(F247, adds `rule_kind`, the two `redact_*` kinds, and `personal_email_role_parts`).
Applied at the single point external data enters the platform —
`applyDataHandling` in `src/lib/ingestion/apply-data-handling.ts` — so no writer
can bypass it by skipping a check somewhere else. Tested in
`src/lib/ingestion/personal-data.test.ts` (the detectors) and
`supabase/tests/rls_policies.test.sql` (who can read or change the rules).

This document is the banned set the migrations above enforce, traced field by
field to the API endpoint it came from and the line of the risk register that
bans it. It is not the data handling policy — `docs/data-handling-policy.md` §2
states the exclusion at the policy level; this is its engineering trace.

## How to read the table

**Mechanism** is one of:

- **field_path (deny)** — the named field is stripped from the payload before
  it is written. Works because the API returns the data as a field with a
  path; F246's original mechanism.
- **redact (email / phone)** — the field is kept, but a regex run over its
  string value(s) replaces anything that looks like a personal email address
  or a phone number with a placeholder (`[redacted:personal-email]` /
  `[redacted:phone]`). Used where the data has no field of its own — it is a
  run of characters inside markup or free text. See
  `src/lib/ingestion/personal-data.ts` for the detectors themselves.

**Live today** means an adapter in `src/lib/ingestion/sources/` actually calls
that endpoint. A rule can exist — and several do — for an endpoint no adapter
calls yet; see "Rules ahead of the data" below for why that's deliberate.

## The banned set

| Field path | Source | API endpoint | Mechanism | Risk register line | Live today? |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `officers[*].usual_residential_address` | `companies_house` | `GET /company/{company_number}/officers` | field_path (deny) | §5(1) — trustee/officer personal data | No — adapter only calls `/advanced-search/companies` and `/search/companies` |
| `officers[*].date_of_birth` | `companies_house` | `GET /company/{company_number}/officers` | field_path (deny) | §5(1) | No |
| `officers[*].nationality` | `companies_house` | `GET /company/{company_number}/officers` | field_path (deny) | §5(1) | No |
| `officers[*].country_of_residence` | `companies_house` | `GET /company/{company_number}/officers` | field_path (deny) | §5(1) | No |
| `officers[*].name` | `companies_house` | `GET /company/{company_number}/officers` | field_path (deny) | §5(1) — "name of trustees", officer equivalent | No |
| `officers[*].occupation` | `companies_house` | `GET /company/{company_number}/officers` | field_path (deny) | §5(1) | No |
| `officers[*].address` | `companies_house` | `GET /company/{company_number}/officers` | field_path (deny) | §5(1). Distinct field from `usual_residential_address` above — this is the officer's correspondence address, frequently also a home address | No |
| `previous_company_names` | `companies_house` | `GET /company/{company_number}` (profile) | field_path (deny) | §5(1), adjacent — historical names can carry a sole trader's own name forward | No — adapter reads search results, not the profile endpoint's full detail |
| `trustees[*].trustee_name` | `charity_commission` | Trustee endpoint (per Charity Commission Charity Register API docs; not called by the live adapter) | field_path (deny) | §5(1) — "name of trustees", named explicitly | No — live adapter calls `GetSearchCharityByRegDate` then `GetCharityDetailsMulti`, neither of which returns trustee records |
| `trustees[*].name` | `charity_commission` | Trustee endpoint (alternative key some Charity Commission endpoints use) | field_path (deny) | §5(1) | No |
| `trustees[*].date_of_birth` | `charity_commission` | Trustee endpoint | field_path (deny) | §5(1) | No |
| `trustees[*].home_address` | `charity_commission` | Trustee endpoint | field_path (deny) | §5(1) | No |
| `trustees[*].other_names` | `charity_commission` | Trustee endpoint | field_path (deny) | §5(1) — aliases | No |
| `trustees[*].name` | `charitybase` | CharityBase GraphQL, `trustees` field on a charity record | field_path (deny) | §5(1) | No — CharityBase's own API is down (see `docs/open-questions.md` D-04); no adapter exists |
| `trustees[*].home_address` | `charitybase` | CharityBase GraphQL | field_path (deny) | §5(1) | No |
| `trustees[*].date_of_birth` | `charitybase` | CharityBase GraphQL | field_path (deny) | §5(1) | No |
| `trustees[*].other_names` | `charitybase` | CharityBase GraphQL | field_path (deny) | §5(1) | No |
| `trustees[*].name` | `find_that_charity` | `GET /reconcile` | field_path (deny) | §5(1). Find That Charity reconciles across registers and can carry a trustee record forward from any of them | No — F034 (the only adapter that calls this endpoint) is unmerged, on `F034-Find-That-Charity-Import` |
| `*` (every string, every field) | *(global — `source` is null)* | Any — applies to every source, including F037's fetched web pages | redact (email) | §5(1) — "personal email addresses", named explicitly | **Yes.** Runs against every payload any live adapter writes |
| `html` | *(global — `source` is null)* | Any source with an `html` field (today: F037's fetched-page payload, once that branch merges) | redact (phone) | §5(1), adjacent — a phone number on a scraped page is frequently a personal mobile or direct line, unlike a registry-supplied switchboard number | Not yet — `html` is the field F037 adds; the rule is inert until that field exists on a written payload, then active immediately with no further change |
| `health_data`, `ethnicity`, `religion`, `political_affiliation`, `sexual_orientation` | *(global)* | Any | field_path (deny) | Data handling policy §2 (special category data), not §5 directly — carried here for completeness since they're seeded by the same migration family | No adapter returns these today |

### Charity Commission bulk register extract (`charity_commission_bulk`)

The bulk import adds a source, not a new class of personal data, so it needs no
new rule — but it needs a record, because the payload is the widest of any
source and "nothing was added" should be a checked statement rather than an
assumption.

| Field | What happens | Why |
| :--- | :--- | :--- |
| `charity.charity_contact_email` | Global `*` redaction rule. Personal addresses become `[redacted:personal-email]`, role addresses (`info@`, `enquiries@`) survive via `personal_email_role_parts` | The same treatment as every other source. Verified on the first live import: 793 records written, all stamped with the rule version, **286 personal addresses redacted** |
| `charity.charity_contact_phone` | Kept | A registry-supplied number is the organisation's switchboard, which outreach legitimately needs. Same reasoning as the API source, recorded in `20260818100400` §5 |
| `count_salary_band_*` (16 fields, £60k–£500k+) | **Never read.** The adapter does not carry them into the payload and there is no column for them | Aggregate in form only: "1 employee in the £450,001–£500,000 band" at a small charity identifies a specific person. Fails the identifiability test in `docs/data-lifecycle-policy.md` §5.7. See `20260922102000_add_charity_scale_and_govt_funding.sql` |
| Trustee count | **Not stored, and not derived** | No extract we ingest publishes one — checked across `publicextract.charity`, `_annual_return_parta` and `_annual_return_partb`. The only route is `publicextract.charity_trustee`, which is trustee *names*: obtaining a count would mean downloading the banned data to count it. If a count is ever wanted it needs explicit Project-Leader approval and an in-adapter derivation that never persists the list |
| `count_employees`, `count_volunteers`, government-funding flags and counts | Stored on `FINANCIAL_PERIODS` | Organisation-level aggregates published by the regulator, identifying no natural person: Public class, same as `total_income` |

The extract is downloaded and streamed by
`src/lib/ingestion/sources/charity-commission-bulk.ts`, whose records go through
`runIngestion` — so `applyDataHandling` runs on every payload before it is
written, the same as every other source. That is load-bearing: the adapter
deliberately does **not** strip contact details itself, because the rules table
is the single place that decides, and a source quietly pre-filtering would make
`excluded_fields` a lie about what was actually removed.

Personal email addresses that a **CAM types by hand** (F036) or that an
import discovers into a manual entry draft (F037) are enforced at the database
boundary on `MANUAL_ENTRY_RECORDS.contact_email` via the trigger in
`20260818100500_block_personal_email_manual_entry.sql` calling `app.is_personal_email()`.
Any attempt to save or submit a personal email address is rejected, ensuring
consistent enforcement across automated and manual ingestion paths (AC3).

## Rules ahead of the data

Most of the table above says "No" under "Live today". That's by design, not
a gap: a rule that exists before the endpoint it covers is the only version
of this control that is ever ahead of the data it's meant to stop, rather
than reacting after the fact. The seed migration
(`20260818100400_add_personal_data_exclusion.sql` §5) makes the same point —
the cost of a rule matching nothing is nothing, and the day an adapter starts
calling an officers or trustees endpoint, the exclusion is already in force
with no code change and no review cycle to catch up on.

## Filing documents (CIC36)

The CIC36 statement job (`src/lib/cic-statement/`, see
[`companies-register-import.md`](companies-register-import.md)) is the first
thing here that reads a **document** rather than a JSON payload, and a CIC
incorporation filing is dense with personal data: director names, dates of
birth, service addresses, and an email address on the CIC36's own contact page.

None of it is stored, by construction rather than by filtering:

1. The PDF is never written to disk. It exists as bytes for as long as OCR takes.
2. Only pages that identify themselves as the CIC36 statement are read at all —
   the IN01, the PSC pages and the statement of guarantee are never OCR'd.
3. Only the two statement boxes are taken from those pages. The extractor
   returns `{ beneficiaries, activities }` or nothing; it has no path that
   returns "the page".
4. What survives goes through `applyDataHandling` before any write, so the
   global `redact_email` rule catches an address a company typed into its own
   statement.

The residual risk is the one described under "Documented limits" below: a
director who names themselves inside their own community interest statement is
not caught, because the platform runs no NER. That is the same boundary a
founder named on an About page already sits on. It is inherited deliberately.

## Documented limits

This system catches personal data that shows up as a **named field** (an
officer or trustee record from a registry API) or as a **regex-matchable
pattern inside a string** (an email address or UK/international phone number
inside markup or free text). It does not catch a person's name written in
ordinary prose with no structural marker — "the charity was founded by
Jane Smith in 1998" on an About page survives untouched. Doing that would
need named-entity recognition (NER), which this system does not run:

- **No NER.** `redactText` in `src/lib/ingestion/personal-data.ts` runs two
  fixed regexes — an email pattern and a phone pattern — over every string a
  `redact_*` rule targets. It has no model of what a person's name looks like
  and cannot find one written as prose.
- **Charity and company names routinely contain a person's name**, and this
  system does not attempt to distinguish "Jane Smith Memorial Trust" (an
  organisation's legal name — needed for outreach, not personal data about a
  living Jane Smith) from a personal name appearing incidentally. Stripping
  names on a pattern match would as often remove the organisation's own name
  as a trustee's, which is the same over-removal cost the allow-list design
  in `personal-data.ts` (see its header comment) explicitly chose to avoid
  for email local parts — but there is no equivalent allow-list move
  available for free-text names, because there is no small, closed,
  nameable set of "safe" names the way there is a small, closed set of role
  email local parts.
- **Consequence for review.** A CAM or admin reading imported markup, notes,
  or a raw payload (`raw_source_records.raw_payload`) may still see a
  personal name in prose even where the platform has correctly redacted every
  email address and phone number on the same page. That's expected, not a
  bug in the redaction rules — it's the boundary of what pattern matching can
  do, and closing it would need a different kind of tool (NER, or a
  human-reviewed name list) that this story doesn't build.
