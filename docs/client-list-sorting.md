# Client list sorting

How the charity list at `/clients` is ordered, and why the outreach-status order
is what it is. Covers **F060** (sort by location, #62) and **F061** (sort by
outreach status, #63).

The code is `sortClients()` in [`src/app/clients/visible-clients.ts`](../src/app/clients/visible-clients.ts);
the control is the "Sorted by …" sentence above the list.

## The two sort controls on this page are different things

There are two "sorted by" sentences on `/clients` and they are not the same
feature:

| Control | URL params | What it orders |
|---|---|---|
| Inside the pipeline report card | `sort`, `dir` | The **grouped breakdown** — which groups (cities, owners, statuses) the top-N table ranks |
| Above the list | `listSort`, `listDir` | The **list rows** themselves |

They are deliberately on separate params so changing one does not disturb the
other, since both are on screen at once.

## What the list can be sorted on

`listSort` accepts `name`, `location` or `status`. `listDir` accepts `ascending`
or `descending`. Anything else falls back to `name`, `ascending` — the order the
list has always used — rather than erroring, because both are URL input and a
pasted link should never break the page.

- **name** — `legal_name`, alphabetical, case-insensitive.
- **location** — the location string the list actually displays: the city, or
  the ISO country code when there is no city (`formatLocation`). Sorting on the
  displayed value rather than on `city` keeps the visible column and the order
  in agreement.
- **status** — pipeline order, see below.

Sorting is applied **after** the filters and **before** pagination. That is what
makes "sort combines with the active filters" (F060 AC3, F061 AC2) true, and it
means page 2 is genuinely the second page of the sorted set rather than page 2
re-shuffled on its own.

## Ties, and why clients with the same location sit together

Every sort tie-breaks on `legal_name`, ascending — and that tie-break is *not*
reversed by `descending`.

So clients sharing a location appear adjacent (F060 AC2), and within that group
they read A–Z whichever direction the locations run. It also makes the order
stable: the same filters and the same sort always produce the same page 2.

## The outreach status order (F061 AC3)

Statuses are **not** sorted alphabetically by their label. Alphabetical would
put "Converted" before "Initial outreach sent", which is backwards as a
workflow. Instead a status sorts on its position in `PIPELINE_STATUSES` in
[`src/lib/organisation-format.ts`](../src/lib/organisation-format.ts) — the
order the F145 pipeline tickets (F146–F155) define:

| # | Status | Label |
|---|---|---|
| 1 | `not_contacted` | Not contacted |
| 2 | `initial_outreach_sent` | Initial outreach sent |
| 3 | `follow_up_sent` | Follow up sent |
| 4 | `responded` | Responded |
| 5 | `converted` | Converted |
| 6 | `future_potential` | Future potential |
| 7 | `soft_no` | Soft no |
| 8 | `hard_no` | Hard no |
| 9 | `no_response` | No response |
| 10 | `loss_due_timing` | Loss due timing |

Read as: the first five are the outreach journey in the order a client travels
it, from untouched to signed. The last five are the ways a client leaves that
journey, warmest first — `future_potential` is worth revisiting, `soft_no` might
soften, `hard_no` will not, `no_response` never engaged, and `loss_due_timing`
was lost to circumstance rather than to a decision.

Ascending therefore reads "furthest from being contacted first", which is the
useful direction for a CAM picking up work. Descending puts the closed and lost
outcomes at the top, which is the useful direction for reviewing what happened.

**If you add a status**, add it to `PIPELINE_STATUSES` in the right position and
update the table above. A status missing from that list sorts to the **end** of
the list in *either* direction — descending pins unknown ranks below known ones
before reversing, so a value that reaches the database before it reaches the
code is visibly last rather than silently leading the list (or floating to the
top of a descending sort).
