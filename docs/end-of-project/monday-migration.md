# Monday.com history — API integration deferred, CSV migration parked

Found while reviewing #239 (F244: Monday.com Import), 10 September 2026.

## What is wrong

Monday.com holds the branch's only outreach relationship history — past
yes/no outcomes and CAM feedback. 180Connect has no copy of any of it, so a
CAM working from the platform alone re-contacts organisations blind, and the
feedback loop the platform exists to build has no past data. PRD names the
current state directly: spreadsheets, separate Gmail inboxes, Google Drive
records, and Monday.com, with no shared source of truth
(`180_Connect_Complete_PRD.md:41`).

Running both systems without a plan is the failure mode PRD warns about:
"Monday.com coexistence creates duplication" without a migration/retirement
plan (`180_Connect_Complete_PRD.md:833`).

## Why it was deferred

#239 as written specced an **API integration** (auth/config failure handling,
downtime handling, `API_HEALTH_LOGS` per the DoD). That is over-engineering
for a one-time move — and the issue itself says "out of summer scope
according to brief". PRD §5.3 explicitly defers "Monday.com bidirectional
integration" beyond V1 (`180_Connect_Complete_PRD.md:166`), while AC3 of #239
already gives the right shape: run **once**, no continuous sync, history
mapped through the standardisation and source-tracking rules (F041, F043) to
pipeline status and notes rather than dumped as text.

An API token, a sync job, and a UI were never needed. A board export is.

## What to do

The replacement is a small ops task (tracked separately — see below), not a
product feature. No new API surface, no stored tokens, no sync:

1. Export the Monday board(s) to CSV — resolves the "API/export access" open
   question on #239 without touching the API at all.
2. Map each row through the same rules as any other import: standardise
   fields (F041), source-track to Monday (F043), dedupe against existing
   organisations (F042), exclude out-of-scope personal data (F247).
3. Land historical outcomes as pipeline status + notes (per #239 AC2), never
   as unstructured text dumps.
4. Run it once against staging first, verify counts and spot-check mapping,
   then run once against production as a service-role script.
5. Set a retirement date for Monday so the team does not do duplicate
   mandatory entry in both systems afterwards.

If the export shows the history is thin or unusable, delete this item with a
line in the commit message saying so — that outcome is fine, it just needs
recording.

## Who decides

`DECISION` — PM confirms the Monday history is worth importing at all, and
signs the Monday retirement plan so coexistence does not become permanent
duplication.
