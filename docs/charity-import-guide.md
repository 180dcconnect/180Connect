# Importing charities — a guide

How charities get from the Charity Commission's public register onto the client
list, and how to run an import yourself.

**Who this is for.** The first half is for anyone who imports charities — CAMs
and admins. The second half is for admins who look after the register itself.
The last section is for whoever maintains the platform later, and points at the
technical documents.

Nothing here requires a developer. If you find yourself needing one to change
*which* charities get imported, something has gone wrong — that decision is
meant to live on the screen, not in the code.

---

## The idea in one minute

The Charity Commission publishes its whole register — every registered charity
in England and Wales, about 171,800 of them — as public files, republished daily.

180 Connect keeps a **complete copy of that register inside the app**, with no
filtering applied to it whatsoever. Every charity is in there: tiny ones, huge
ones, every sector, every part of the country.

Choosing which of them become clients is a separate act, done on screen, by you.

```
  The regulator's files          The copy in the app            Your client list
  (published daily)              (all 171,800, unfiltered)      (the ones you chose)

        ─────────────►                  ─────────────►
        rebuilt monthly,                you filter and import,
        automatically                   any time
```

Think of it as a phone book delivered to the office and left on the shelf. It
holds everyone. You flip through it with sticky notes to decide who to call.
Deciding is instant, because the book is already in the room — nobody drives to
the library each time you change your mind.

**Why it matters that the copy is unfiltered.** The previous version of this
feature made the choice for you, in code. It only imported charities earning over
£100,000, in five sectors, in four named towns. Nobody using the app could see
those rules, and changing them meant a developer and a pull request. They were
also wrong: the income floor alone excluded 3,229 of the 4,340 charities local to
the branch, and a bug in the town matching meant the Sheffield rule never
actually matched Sheffield. 180DC Sheffield works pro bono — an income floor is
close to the opposite of what it needs.

So now there are no built-in rules. You set them, you see what they cost, and you
can change your mind tomorrow.

---

## Running an import

Go to **Admin → Data imports → Charity Commission**.

CAMs and admins can do this. Viewers cannot. This is a deliberately wider door
than the rest of the admin area: the whole team shapes and runs imports rather
than queueing behind one person. The safeguard is not that few people can do it,
but that every import is visible — confirmed against a live count first, and
recorded afterwards with your name on it.

### 1. Check the register is current

The **Charity register** card at the top tells you how many charities are staged
and when the copy was taken.

A copy a few weeks old is normal — it is rebuilt monthly, and the card only
warns once something has actually gone wrong. If you do see the amber warning,
a rebuild has been missed: the register may not list charities registered since,
and may still list charities that have closed. Ask an admin to refresh it (see
[Refreshing the register](#refreshing-the-register)).

If the card says the register is not loaded, nothing can be imported until an
admin rebuilds it.

### 2. Set your filters

Everything below the card is a filter. An empty filter means **"don't filter on
this"** — never "match nothing". The screen opens on the whole register, and each
filter you add narrows it.

**Size.** A "From" and "To" income range, plus a checkbox: *Include charities
with no published income.*

> Leave that checkbox ticked unless you have a specific reason not to. The
> register publishes no income figure for a large number of charities, and that
> means *not published* — not zero, and not small. Treating it as small is what
> hid 238 local charities under the old rules.

**Location.** Two ways of being local, and either one is enough:

- **Postcode areas** — where the charity's registered address is (`S`, `LS`, and
  so on; type any area and press Enter to add it).
- **Areas of operation** — where the charity *tells* the register it works.

They combine with OR on purpose. A charity based on your doorstep that never
filled in its area of operation is still on your doorstep. A charity that names
Sheffield but is registered to a London accountant is still working in Sheffield.
Either alone would miss real prospects.

You can also filter by the register's own local authorities (174 of them) and
regions.

**What the charity does / who it helps / how it works.** The register's three
classification systems — 17, 7 and 10 options respectively. The last two were
never filterable at all before.

**Registration and status.** Registration date range (any period, past or
recent), charity type, whether accounts have been filed, solvency, and a name
search.

### 3. Preview

Press **Preview**. You get a count and a sample table — charity name, income,
postcode, and the register's own words for what they do.

Use this properly. The count moving as you widen or narrow a bound is the whole
point of the screen: it is how you find out what a criterion actually costs
before you commit to it. A filter that looks sensible and returns 4 charities, or
40,000, is telling you something.

The sample is a sample, not the whole selection.

### 4. Import

Press **Import these charities**. You get a confirmation step that restates the
count and your criteria in plain words, and tells you it will be recorded against
your name. Press again to confirm.

Two guards:

- If you have set **no filters at all**, the screen warns you that this selects
  the entire register — which is almost certainly not what you want.
- A single import is capped at **10,000 charities**. Nobody should be able to
  create a hundred thousand organisations by accident.

### 5. Read the result

You get a sentence, not a table of numbers. Something like:

> *412 added to the client list, 37 flagged for review, 8 did not meet the client
> criteria.*

What those mean:

| Phrase | What happened |
| --- | --- |
| **added to the client list** | New organisation created. It's a client now. |
| **flagged for review** | Either it looks like a duplicate of something already on the list, or it partly meets the client criteria. A person decides — nothing is merged or discarded automatically. |
| **did not meet the client criteria** | Failed the criteria check. Not added. See [`client-criteria.md`](client-criteria.md). |
| **had no usable name** | The register row was unusable. Rare. |
| **failed to write** | A genuine error. It's been recorded. |

Imported charities arrive with their filed accounts attached where the register
has them, so financial history is there from the start.

### Re-running is safe

**Charities already on the list are matched, not duplicated.** Records are
checksummed, so importing the same selection twice costs almost nothing and
creates nothing. Re-run a filter set whenever you like — after a register
refresh, or at the start of a new cycle to pick up newly registered charities.

---

## Saved filter sets

**Saved sets** sits in the bar at the top of the screen, next to Import — the bar
describes the whole selection, and a saved set *is* a whole selection.

- **Load one:** open the menu and click it. If you have unsaved work on screen,
  it asks before replacing it.
- **Save one:** open the menu → **Save this selection…**, give it a name. Saving
  under a name that already exists replaces that set, and the dialog says so
  before you commit.
- **Delete one:** the bin on a row in the menu.

Once a set is loaded, its name shows under the count, with **· modified** as soon
as you change a filter — so you always know whether Save makes a new set or
replaces the one you started from.

Worth doing for anything you'll run more than once — *"Sheffield arts, any
size"*, *"South Yorkshire, £50k–£500k"*. A selection then becomes something the
team keeps and re-runs rather than something one person rebuilt from memory.

Saved sets are shared across the team, not personal — deleting one deletes it for
everyone.

---

## Looking up a single charity

Beside **New import**, at the top of the import history: *Looking for one
particular charity? Look it up by number.*

Use this when you know exactly who you want and don't want to wait for a register
refresh — it asks the Charity Commission's API directly, so it sees the charity
as of right now. For anything more than one charity, use the filters instead.

It works in two steps, and **nothing is saved until you say so.**

**1. Look it up.** Type the registration number (digits only) and press
**Look up charity**. This only reads — no import has happened yet.

**2. Check what came back.** You get the charity's name and number, its type,
location, website and contact email, and its latest filed income and
expenditure if the register has them. Read the name first: this is the step
where a mistyped digit shows up as somebody else's charity, before it is on
your client list rather than after.

Two things to watch for here:

- **"This charity has been removed from the register."** It is no longer a
  registered charity. Nothing stops you importing it, but you probably do not
  want to.
- **The green line at the bottom** tells you what saving will do — join the
  client list, be held for review, or not be added at all. The button says the
  same thing, so it can't promise something different.

If the charity is already on your client list, you are told so and given a link
straight to the record. There is nothing to save in that case.

**3. Save it, or don't.** **Add to the client list** imports it. **Cancel** or
**Look up another charity** throws the lookup away and leaves no trace — no
import run, no record, nothing to clean up.

Once saved you get the charity's name, whether it was added or was already
there, a note about its grant history, and a link to open the record.

This is the only part of charity importing that uses an API key. If it says it
isn't configured, an admin needs to set `CHARITY_COMMISSION_API_KEY`.

---

## Refreshing the register

**Admins only.** CAMs will not see this working.

The **Refresh register** button on the Charity register card rebuilds the copy
from the regulator's current files.

What actually happens: the app asks GitHub to run the rebuild. It takes about
twelve minutes, because it reads roughly 1.8GB of published extracts. Then the
app automatically redeploys with the new copy. You can leave the page — the
button shows progress if you stay.

**Why this is admin-only while importing is not.** Choosing which charities to
import is everyday work. Spending a build and redeploying the application is not,
and a stuck refresh is the kind of thing one person should own.

### When to refresh

The rebuild also runs **automatically on the 1st of each month**, so most of the
time you never touch it. Refresh by hand when:

- You need charities registered in the last few weeks.
- Someone reports a charity on the list that has actually closed.
- The card says the register isn't loaded at all.

> **What the stale warning means.** The card only warns once the copy is more
> than 35 days old — a month plus slack for the rebuild and the redeploy that
> carries it. So the warning is not "this is a few weeks old", which is normal
> and fine; it is **"a monthly rebuild was missed, or a deployment didn't pick
> it up"**. Worth acting on rather than living with.

### If the refresh button isn't there

The deployment needs `GITHUB_REGISTER_TOKEN` set. Without it the button explains
that refreshing isn't configured here.

---

## Staff and volunteer counts

Charities report how many staff and volunteers they have on Part B of the annual
return. That part is only published in the bulk extract, so it reaches us through
the register file and never through the live lookup. A client whose accounts came
in through the lookup therefore has five years of income and a blank where the
headcount should be, and the Financials tab says "People — not reported" for a
charity that in fact declares thousands of them.

Re-running an import does not fix it: a charity already on the client list is
recorded as a match rather than imported again.

The weekly accounts refresh now fills this in by itself, straight after it
writes, so in normal running you should never need to touch it. **Staff and
volunteer counts** on the imports page is there for when you do: it shows how
many of your charities already hold everything the register publishes about their
filed years, and fills in the rest at one press, rather than waiting for the next
weekly run. Same permission as importing: CAMs and admins, not viewers.

One gap neither can close: the register file rebuilds monthly, so a year filed
since the last rebuild has no staff count published anywhere yet. It appears on
its own once the register is next refreshed.

Worth knowing:

- It only ever **adds**. A figure already on a record is left exactly as it is,
  even where the register now disagrees.
- It only touches years you already hold. Adding a missing filed year is an
  import, and the import screen is where that decision is made.
- Income, expenditure and the income breakdown are never rewritten. Those come
  from the nightly lookup and stay its job.
- A charity that files an entry-level return has no Part B anywhere, so it is
  never counted as outstanding. The counter reaching every charity means every
  charity.
- It needs the register loaded, so if the card offers nothing, check the register
  card above it first.

---

## Common questions

**Can I undo an import?**
Not from this screen. Imported organisations are ordinary clients — remove or
reassign them the way you would any other. Which is a good reason to preview
before importing.

**Why is a charity I expected missing?**
Most often one of three things: your income range excludes it; you unticked
*Include charities with no published income*; or your location filter is
narrower than you think. Clear all the filters, search by name, and add filters
back one at a time watching the count.

**Why did a charity get "flagged for review" rather than added?**
It matched something already on the list (by registration number, or by name and
postcode), or it partly met the client criteria. Duplicates are flagged and never
merged automatically, because merging the wrong two records is much harder to
undo than approving a flag.

**Does importing email anyone?**
No. Importing only adds organisations to the client list. Outreach is a separate,
deliberate act.

**Is contact data from the register personal data?**
The register publishes a correspondence email for most charities and a phone
number for nearly all of them. The platform's data-handling rules are applied at
the moment of import, so anything the current policy excludes never enters the
system. If those rules can't be read, the import stops rather than guessing — see
[`data-handling-policy.md`](data-handling-policy.md) and
[`personal-data-exclusions.md`](personal-data-exclusions.md).

**Where can I see past imports?**
The **Recent runs** section at the bottom of the page, and `/admin/import-status`
for every ingestion of every kind. Every import is also in the audit log with who
ran it, the criteria in words, and how many organisations it created.

---

## For whoever maintains this later

The short version of the architecture, and where to read more.

### Three steps, separated on purpose

| Step | What | Where | Cadence |
| --- | --- | --- | --- |
| **1. Build** | Read the regulator's daily extracts, write `register.sqlite` (~180MB, all 171,800 charities + filed returns). **Applies no selection criteria.** | `.github/workflows/refresh-charity-register.yml` → `scripts/build-register-sqlite.mts` | Monthly cron + `workflow_dispatch` from the Refresh button |
| **2. Ship** | Publish as a GitHub Release asset; every Vercel build downloads it into the deployment | `scripts/fetch-register.mts`, wired as `prebuild` | Every build |
| **3. Choose & import** | Filters → SQL over that file → `raw_source_records` → the unchanged `charity_commission_bulk` promote path | `/admin/charity-commission`, `src/lib/charity-register/` | On demand |

They are separated because they change at wildly different rates. The expensive
half (parsing 1.8GB) changes daily and is identical for everyone; the selective
half changes constantly and is specific to this branch. Fusing them is what made
the old version unchangeable.

### Things that will bite you

- **The register is a file, not a table.** Staged in Postgres it cost 570MB
  against a 500MB free tier, for public data that regenerates in twelve minutes.
  `sqlite.ts` is `server-only` and must stay that way — the file carries contact
  details for 171,800 organisations and must never reach a browser.
- **Criteria are data, not code.** If you are about to add a constant that
  decides which charities are acceptable, stop. That is the exact mistake this
  design exists to prevent.
- **The workflow only works from the default branch (`dev`, not `main`).** GitHub
  will not fire a `schedule:` or expose `workflow_dispatch` from anywhere else.
- **Data-handling rules run at import, not at build.** So the CI job needs no
  database credentials, and the *current* policy applies rather than one frozen
  into an artefact built weeks earlier. It fails closed.
- **Charity Commission API discovery was retired** (2026-09-03). The bulk extract
  already contains everything it found, with better contact coverage. Only the
  single-charity lookup still uses the API.

### Keys involved

| Key | Where | For |
| --- | --- | --- |
| `GITHUB_REGISTER_TOKEN` | Vercel | The Refresh button — dispatches the workflow and polls it. Fine-grained, Actions read/write, this repo only |
| `REGISTER_DOWNLOAD_TOKEN` | Vercel | `prebuild` fetch of the release asset. Required once the repo is private |
| `CHARITY_COMMISSION_API_KEY` | Vercel | Single-charity lookup and the weekly financial refresh only. **The bulk import does not use it** |
| `VERCEL_DEPLOY_HOOK_URL` / `_PRODUCTION` | GitHub secrets | Redeploy after a rebuild, one per environment |

The register build itself needs no secrets at all — public file in, file out.

### Read next

- [`charity-register-import.md`](charity-register-import.md) — the design and the
  reasoning behind it, in full, including what was measured and what was retired
- [`ingestion.md`](ingestion.md) — the four ingestion stages, every source, and
  what runs on a schedule
- [`client-criteria.md`](client-criteria.md) — how accepted / needs review / does
  not meet is decided
- [`audit-log-pattern.md`](audit-log-pattern.md) — how imports get recorded
