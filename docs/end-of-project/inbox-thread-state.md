# Per-viewer inbox thread state

Found while making `/inbox` work against real data, 8 September 2026.

## What is wrong

Three of the mailbox's controls — **star**, **mark read/unread**, and **move to
trash** — have no storage behind them anywhere in the schema.

`buildRealInboxThreads` has to invent both flags it hands down
(`src/lib/inbox/real-threads.ts:362`):

```ts
// No per-user read state exists in the schema, so "unread" is the one
// thing a CAM actually opens the inbox to find: a reply nobody has
// answered yet. Everything else reads as already seen.
isRead: status !== "replied",
isStarred: false,
```

Until now the shell held every change in React state alone, so starring a
thread, marking it read, or trashing it lasted exactly until the next
navigation — the action appeared to work and then quietly undid itself.

That is fixed *as far as it can be without a table*: the flags now persist per
viewer in `localStorage` (`src/lib/inbox/thread-flags.ts`). The shape is right —
these are per-viewer facts, and a per-viewer store is what they want — but the
**reach** is wrong in two ways:

- They do not follow a CAM to another device or browser. Star a thread on the
  laptop, and the phone still shows it unstarred.
- They are invisible to the server, so nothing else can read them. A "starred"
  filter on the dashboard, or a notification that skips threads the CAM has
  already read, cannot be built on a value that only one browser holds.

Trash is the sharpest case: a thread trashed on one machine is still in the
inbox on the next, which reads as the delete having failed.

## Status — done, bar one thing

Approved by Bashir (Project Leader), 8 September 2026, including the trash cap.
Delivered:

- `supabase/migrations/20260924090000_create_inbox_thread_state.sql` — the
  table, the `inbox_read_state` enum, RLS (own-row only, no admin branch), the
  200-per-user trash cap trigger, and `prune_inbox_thread_state()`.
- `supabase/migrations/20260924090100_schedule_inbox_thread_state_prune.sql` —
  the daily 30-day purge job. Rollbacks for both.
- `docs/rls-permission-matrix.md` §3.25; Data Model tab 04 Entities + tab 02 +
  step 28.0.
- `src/app/inbox/actions.ts` — `applyInboxThreadFlags`, one round trip per
  action however many threads it covers.
- `src/lib/inbox/thread-flags.ts` — server-backed optimistic store. The
  localStorage path is gone rather than kept as a fallback: two stores that can
  disagree is worse than either alone.

Verified against a real database: full `supabase db reset`, all 24 pgTAP suites
(852 assertions), RLS coverage gate at 48 tables, and hand-run checks for the
cap's eviction order, the anti-backdating trigger, the prune, and own-row
isolation across CAM / other CAM / admin / deactivated.

**Remaining:** the mailbox's `isImportant` flag is still local-only. It was
left out deliberately — nothing in the UI sets it, so a column for it would
have been schema with no writer. If an "important" control ever ships, it is
one more boolean on this table and one more set in `ThreadFlags`, not a new
design.
