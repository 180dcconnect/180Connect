# Manual URL import (F037)

A CAM pastes an organisation's website address, 180Connect reads what the site says
about itself, confirms it against the public registers where the site gives a
registration number, and leaves a **draft** for the CAM to review. Nothing becomes a
client until the CAM submits that draft through the F036 manual-entry flow.

## Why it is built on F036 rather than beside it

The import does not have its own staging table, its own duplicate check or its own
approval step. It fills a `MANUAL_ENTRY_RECORDS` draft, and everything after that is
F036's: the review form, the submission rules, `approve_manual_entry` with its F042
duplicate matching and its create-new/link-existing decision.

That is what makes several of F037's acceptance criteria fall out of work that already
exists — review before saving, no automatic duplicate, admin approval — rather than
being a second implementation of the same rules that can drift from the first.

## The flow

```
CAM pastes URL
  → robots.txt check for the site               (src/lib/import/robots.ts)
  → SSRF-safe GET, redirects re-checked per hop (src/lib/import/fetch-page.ts,
                                                 page-transport.ts)
  → page stored in RAW_SOURCE_RECORDS           (store-fetched-page.ts)
  → read what the page says                     (extract-organisation.ts)
  → confirm against the registers               (registry-lookup.ts)
  → merge, with the register winning            (build-draft.ts)
  → MANUAL_ENTRY_RECORDS draft                  (create_url_import_draft)
  → CAM reviews, edits, submits                 (F036)
```

## Which register

**Not the Charity Commission by default.** 180Connect's clients are charities,
non-profits, CICs and sustainability-focused companies, and `organisation_type` has
been `charity | company | both | other` since the schema was created. The site's own
footer decides:

| Found on the page | Looked up against | Resulting type |
| --- | --- | --- |
| England and Wales charity number | Charity Commission | `charity` |
| Company number | Companies House | `company` |
| Both | Both | `both` |
| Neither, but a name | Companies House exact-name search | whatever it confirms |
| Scottish (`SC…`) or NI (`NIC…`) number | nothing — no adapter for those registers | left blank, noted to the CAM |

A charity registered in more than one nation prints all of its numbers together, so
the England and Wales number is searched for **first**. The British Heart Foundation's
footer reads "registered charity in England and Wales (225971), Scotland (SC039426)";
a prefix-first search finds the register this platform cannot query and misses the one
it can.

The name search is the last resort and only runs when nothing else identified the
organisation. Companies House already refuses to choose between two exact matches,
which is the right failure: an unconfirmed guess is worse than a blank field a CAM
fills in.

## What comes from where

A register beats the website for anything a register holds; the website is the only
source for anything it does not.

| Field | Source, in order |
| --- | --- |
| `legal_name`, `address_line_1`, `city`, `postcode` | Companies House → Charity Commission → website |
| `contact_email` | Charity Commission → website |
| `mission_statement` | website only — no register publishes one |
| `website` | the page that was just fetched — registers hold stale website fields |
| `organisation_type`, `registry_name`, `registry_number` | confirmed registrations only; blank when nothing was confirmed |

A charitable company has two registrations and `MANUAL_ENTRY_RECORDS` has room for
one. The charity registration is kept, because that is the one a CAM quotes and the
one F047 eligibility turns on; the company number is surfaced as a note rather than
dropped. `ORGANISATION_IDENTIFIERS` can hold both, and connecting the two is worth
doing when F044's identifier write path lands.

## No LLM, no headless browser

Most of the value is not in the prose — it is in the identifiers, which are formatted
by law and read perfectly well with a regular expression. What a page says about
itself is unverified either way, and a model that infers a mission from body copy
produces something fluent and unattributable where a site's own description is at
least a quote. The CAM confirms every field before it is saved, so precision beats
recall: a blank field costs a line of typing, a confident wrong one costs a bad record
nobody re-checks.

A JavaScript-rendered homepage yields little. That is handled rather than worked
around — it becomes the "not enough to identify the organisation" outcome, with the
manual form directly below it (F256). `mind.org.uk` is a live example: its server HTML
carries a name and a description but no registration number anywhere.

## Retrieving website content: the legal and technical position

The open question on the ticket was the basis for retrieving public website content.
What is implemented:

- **One page, on a human's instruction.** A CAM pastes a specific address and presses
  a button. There is no crawler, no queue, no scheduled re-fetch, no link following.
- **robots.txt is honoured**, for the pasted URL and again for the redirect
  destination if it lands on a different site. An unreachable robots.txt means
  unrestricted, per RFC 9309.
- **We identify ourselves**: `180Connect-Import/1.0 (+https://180dc.org; charity
  research; contact sheffield@180dc.org)`.
- **Organisation-level fields only.** The extraction never looks for people. Where an
  email must be guessed from body text it prefers a role inbox (`info@`, `contact@`)
  and takes a named individual's address only if there is no role inbox at all — in
  line with the data handling policy's commitment to collect no more than the minimum
  professional contact needed for outreach.
- **The fetched page enters through the raw layer**, `RAW_SOURCE_RECORDS` with
  `record_source = 'website'`, so retention, the field-level data handling rules
  (F246) and any later audit see it exactly as they see an API source.

Registry responses fetched during an import are deliberately **not** written to the
raw layer: they are re-fetchable from an authoritative API at any time, and writing
them out-of-band would collide with the scheduled importer's checksum bookkeeping on
the same `(record_source, source_record_id)` key.

## Safety of the fetch

This is the one place in the product where an end user chooses the destination of a
server-side request, so it reuses F046's model rather than inventing one:

- format check rejects private hosts, credentials in the URL, and non-HTTP schemes;
- DNS is resolved and checked, then the TCP connection is **pinned to that address**
  while the URL keeps its hostname, so a second DNS answer cannot redirect the request
  (this is why it uses `node:http`/`node:https` and not `fetch` — nothing else exposes
  a `lookup` hook);
- every redirect hop is re-resolved and re-checked; at most three are followed;
- the response must be HTML and is capped at 3MB;
- no HTTP status, host error or stack ever reaches the CAM — the real diagnostic goes
  to `ERROR_LOG` and the CAM gets a sentence about what to do next (AC11).

## Failure states (F256)

| Outcome | What the CAM sees |
| --- | --- |
| Malformed or unsafe address | "That does not look like a website address we can open…" |
| Unreachable, or refused by robots | "We could not reach that website…" / "This website asks automated tools not to read that page…" |
| Not a web page (PDF, image) | "That address is a file rather than a web page…" |
| Empty page | "That page was empty, so there was nothing to import." |
| Reached but unidentifiable | "We reached that website but could not find enough to identify the organisation." |
| Register unavailable or number wrong | The draft is still created; a note says which number could not be confirmed. |

The first five leave the CAM on the same page as the manual form, so declining an
import and typing the record are the same click apart.

## Provenance (AC8, AC12)

`MANUAL_ENTRY_RECORDS` gained four columns:

| Column | Holds |
| --- | --- |
| `source_url` | the URL the values came from, after redirects |
| `imported_field_paths` | which columns the import filled rather than the CAM |
| `import_notes` | what the import could not confirm, in the CAM's own words |
| `import_raw_record_id` | the stored page the draft was built from |

The review screen badges every imported field. Editing one removes the badge as the
CAM types, and `set_url_import_provenance` intersects the submitted list with what was
already recorded, so provenance can only ever narrow — a hand-typed value can never be
attributed to a website.

After approval, `get_organisation_import_origin` gives any active user the source URL
for a client that came from an import.

## Data Model changes this depends on

The spreadsheet is the source of truth (SOP §7) and `docs/data-model/` is generated
from it, so these rows need adding there and `npm run export:data-model` re-running:

**Tab 03 Raw Data — `RAW_SOURCE_RECORDS.record_source`**: add `website` to the
permitted values.

**Tab 03 Raw Data — `MANUAL_ENTRY_RECORDS`**: four new fields.

| Field | Type | Nullable | Description |
| --- | --- | --- | --- |
| `source_url` | text | Yes | Website the imported values came from, after redirects |
| `imported_field_paths` | jsonb | No | Columns filled by the import rather than typed by the CAM |
| `import_notes` | jsonb | No | What the import could not confirm, as shown to the CAM |
| `import_raw_record_id` | uuid → RAW_SOURCE_RECORDS | Yes | The stored page this draft was built from |

## Still open

- **Cross-referencing beyond the two registers.** Find That Charity's reconcile
  endpoint could resolve a name where Companies House finds several matches. Not wired
  up: it answers with candidates and scores, which needs a CAM-facing "which of these
  is it" step that does not exist yet.
- **Scotland and Northern Ireland.** OSCR and CCNI numbers are recognised and shown
  but never looked up. Worth an adapter if Scottish clients become common.
- **Both registrations on one record.** See the charitable-company note above.
