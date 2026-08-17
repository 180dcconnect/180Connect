# Personal data exclusions

**Spec:** Technical Brief §5, Data & Legal Risks (1): "if APIs can return private
information such name of trustees, personal email addresses, which shall not be
stored or used in any way or form."

**Enforced by:** `supabase/migrations/20260817130000_create_data_handling_rules.sql`
(F246, field-level deny-list) and `20260817130200_add_personal_data_exclusion.sql`
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

Personal email addresses that a **CAM types by hand**, rather than one an
import fetches, are a gap this table doesn't close yet:
`MANUAL_ENTRY_RECORDS.contact_email` needs its own trigger
(`app.is_personal_email`, already shipped in the F247 migration, is that
trigger's dependency), but the table it would guard doesn't exist on any one
branch yet — F036 is open at #360 against `dev`, F246 (which created
`data_handling_rules`) is merged to `main`, and no branch currently has both.
The trigger is written and reviewed, held as
`20260817130300_block_personal_email_manual_entry.sql`, ready to ship the
moment `main` and `dev` meet. See the branch-reconciliation note the team is
tracking separately.

## Rules ahead of the data

Most of the table above says "No" under "Live today". That's by design, not
a gap: a rule that exists before the endpoint it covers is the only version
of this control that is ever ahead of the data it's meant to stop, rather
than reacting after the fact. The seed migration
(`20260817130200_add_personal_data_exclusion.sql` §5) makes the same point —
the cost of a rule matching nothing is nothing, and the day an adapter starts
calling an officers or trustees endpoint, the exclusion is already in force
with no code change and no review cycle to catch up on.

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
