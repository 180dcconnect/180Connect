# Unfinished work

Some sidebar destinations are part of the platform's map before the page
behind them exists — the sidebar's own user story is "a sidebar with main
pages," and a section going missing until launch day would misrepresent the
platform's shape. For those, `src/lib/nav.ts` sets `plannedFeatureId` on the
entry instead of leaving it out. `Sidebar` renders the link, but instead of
navigating, a click opens a dialog: "This page isn't built yet," with the
feature ID.

Every `plannedFeatureId` in `nav.ts` must have a file here named
`<slug>.md`, where `<slug>` is the last segment of the entry's `href` — e.g.
`href: "/actions"` → `docs/unfinished-work/actions.md`. `nav.test.ts` checks
both directions: a `plannedFeatureId` with no matching doc fails, and so does
a doc with no matching entry.

## File format

```markdown
# <Feature name>

- **Feature ID:** F168 (PRD: `180_Connect_Complete_PRD.md`)
- **Sidebar entry:** `/actions` ("Actions")
- **Depends on:** F162, F170, F173
- **Sprint:** 11 — Ownership, actions & notifications

<One or two sentences on what the page needs to do, if it's not obvious from
the PRD user story alone — e.g. a design decision already made, or a
constraint discovered while building something adjacent.>
```

## Landing the page

When the route ships:

1. Delete `docs/unfinished-work/<slug>.md`.
2. Remove `plannedFeatureId` from the entry in `nav.ts` — the existing
   "routes exist" check then covers it like any other link.
