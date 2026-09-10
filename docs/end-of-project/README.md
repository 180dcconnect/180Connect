# End of project

Work that was deliberately **not** done at the time it was found, parked here to
be worked through one item at a time near the end of the project.

This is not a bug tracker and not the sprint board. The sprint board
(`180dcconnect` → "Backlog", project 3) carries anything with a delivery date.
What lands here is the other category: a gap that is real, understood, and
deliberately deferred — usually because fixing it properly needs a decision
nobody is ready to make yet, or because it would widen a PR past what it was
opened for.

## How to use it

Each file covers one area. Every item in a file states, in this order:

1. **What is wrong** — the observed state, with file and line references so it
   can be checked rather than taken on trust.
2. **Why it was deferred** — what stopped it being fixed at the time.
3. **What to do** — the concrete change, and *where* it goes. For anything
   touching the schema, that means naming the spreadsheet tab, because the
   repo's `docs/data-model/*.md` is generated and cannot be hand-edited
   (SOP §7 — see below).
4. **Who decides** — marked `DECISION` where it needs a PM call rather than
   just someone's time.

Work an item, then delete it from the file. An item that turns out to be wrong
gets deleted too, with a line in the commit message saying why.

## The one rule that catches people out

Anything describing a database table is governed by the **Data Model
spreadsheet** (`~/Downloads/Data Model.xlsx`), not this repository. SOP §7 makes
the spreadsheet the source of truth. `docs/data-model/*.md` is a generated
projection of it — every one of those files opens with a DO NOT EDIT header.

So a schema change is always two steps, in this order:

```bash
# 1. edit the spreadsheet tab named in the item
# 2. regenerate and commit the projection
npm run export:data-model
```

Editing the markdown directly looks like it worked and is silently reverted by
the next export.

## Contents

- [`data-model-gaps.md`](data-model-gaps.md) — tables the Data Model describes
  that the database does not have, and the DoD checkboxes that depend on them.
  Found while reviewing PR #543 (the analytics epic), 6 September 2026.
- [`inbox-thread-state.md`](inbox-thread-state.md) — the mailbox's star, read
  and trash controls have no table behind them; they persist per browser as an
  interim. Found while making `/inbox` work against real data, 8 September 2026.
- [`outreach-prod-env.md`](outreach-prod-env.md) — the Gmail and `CRON_SECRET`
  secrets are set on Vercel Preview only, so production cannot send or run
  scheduled outreach. Found checking whether send/schedule work, 9 September
  2026.
- [`time-spent-tracking.md`](time-spent-tracking.md) — F211's own ethics
  question has no answer, and the audit log has no session data to source it
  from honestly. Descoped while triaging the Analytics backlog, 10 September
  2026.
- [`recurring-follow-up.md`](recurring-follow-up.md) — F127's auto-recurring
  send conflicts with the human-approval DoD requirement, and what's left
  after that constraint is already covered by F160 + F126. Descoped while
  triaging the Email Sending backlog, 10 September 2026.
