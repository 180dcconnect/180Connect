# "Your actions" dashboard card — known gaps

Found while reviewing the card end-to-end (`src/components/dashboard/my-actions-card.tsx`,
`src/lib/dashboard/my-desk.ts`), 17 September 2026. Two items from the original
review (the combined "later or no date" footnote, and overdue rows carrying no
sense of how overdue) were fixed the same day rather than parked — neither
needed a decision, just a template and a field. What's left below are the two
that do need one.

## 1. No mark-done from the card

**What is wrong.** Every row (`ActionRowItem` in `my-actions-card.tsx`) links out
to `/clients/[id]`. Completing an action always costs a navigation, even for a
one-line action someone wants to close immediately after reading it on the
dashboard.

**Why it was deferred.** Keeping the card a read-only summary was a deliberate
choice (see the card's own doc comment: it replaced the Action Center precisely
to stop the dashboard from growing a second workflow surface). Adding a write
here reopens that question.

**What to do.** If wanted: a small "Done" affordance per row, calling the same
server action `/clients/[id]/outreach` or the actions list uses to close an
action, then optimistically removing the row. Scope it to `canWrite` accounts
only (view-only already gets no card — `dashboard/page.tsx`'s `actionsRead`).

**Who decides.** `DECISION` — whether the dashboard should ever carry a write,
even a small one.

## 2. Nothing here shows an admin the team's actions

**What is wrong.** The card is always scoped to `assignee_user_id = actor.id`
(`dashboard/page.tsx`, the `actionsRead` query) — an admin sees only their own
open actions, never the branch's as a whole. There is no "whose queue is
piling up" view anywhere on the dashboard.

**Why it was deferred.** Intentional per the card's own doc comment: "Your
actions" was scoped to replace the old Action Center's dated-work gap, not to
become a team-wide management view. Whether leadership actually wants a
team-level rollup was never asked.

**What to do.** If wanted: a separate admin/leadership-only card or section —
counts of overdue actions per CAM, or just a total across the branch — reusing
`summariseMyDesk`'s overdue/due-soon split but fed all open actions rather than
one assignee's. Given viewers already see every admin screen and change
nothing (`docs/architecture.md` roles model), this would need its own
`canView` gate, not `canWrite`.

**Who decides.** `DECISION` — whether this is wanted at all, and if so, whether
it lives on the dashboard or on `/actions` as an admin-only tab.
