# The app's design system

The logged-in app — `/dashboard`, `/clients`, `/admin`, `/settings`. Everything
after sign-in.

Public surfaces (landing, legal, login, the marketing chrome) are a *different*
system and are documented in [`design-system.md`](design-system.md). That doc
says at its head that the app is "deliberately not held to this". True, and it
left the app with no written rules at all. This is that missing half.

## Source of truth

Same rule as the public system: anything expressible in code is authoritative in
code, and this file carries only what code cannot — intent, and why choices that
look arbitrary aren't.

| Need | Where |
| --- | --- |
| Colour, radius, font tokens | `src/app/globals.css` (`:root` + `@theme inline`) |
| The card, the status pill, the register key | `src/app/(app)/clients/[id]/section-card.tsx` |
| Entrance motion | `src/components/dashboard-stage.tsx`, built on `src/components/brand/motion.ts` |
| Which to use, and when | this file |

Never write a hex value in a page file. `#f4f4ef` is currently hand-copied into
20+ files and that is the single largest source of drift in the app — see
[Open question: the ground](#open-question-the-ground).

## Reference screens

The app is mid-migration between two visual languages. Copying the file next to
the one you're editing is how the old one keeps spreading. Copy these instead:

| Screen | Path | What to take from it |
| --- | --- | --- |
| **Client record** | `src/app/(app)/clients/[id]/` | **The token reference.** Surfaces, borders, type scale, pills, tabs. When this doc and another screen disagree on *how a card looks*, this wins. |
| **Data imports** | `src/app/(app)/admin/charity-commission/` | **The structure reference.** Page shell, the heading block and its tab row, the rail of facts under it, the two-view console, and stat cards (big numeral, hint, `HorizontalStickGauge`, action zone). Take the *skeleton* from here. |
| **Dashboard** | `src/app/(app)/dashboard/page.tsx` | Page composition and horizontal space reference — the `Stage`/`Group`/`Rise` structure, the `mx-auto w-full max-w-[1400px]` container, the display heading, cards floating on the ground rather than one box holding everything. Its *surfaces* are the old language; do not copy those. |

Not references, for now:

- `src/app/(app)/clients/page.tsx` — work in progress.

**On `src/app/(app)/admin/*`.** This doc used to say "never copy an admin page", because
several pages were on `#f1f2f4`, two grounds stale. That is now half wrong and the
wrong half is the dangerous one. The **tokens** are still not to be copied from
there: `recent-runs.tsx`, `group-tabs.tsx` and `lookup-dialog.tsx` are on the old
language (`rounded-2xl`, `border-black/[0.07]`, `text-foreground/40`, `text-brand`),
and copying those is how the old system keeps spreading. The **structure** is a
different matter — the Data imports screens are the app's most-developed version of
the heading-block-plus-console page, and `/clients/new` was rebuilt onto it
deliberately. So: take the skeleton from an admin Data-imports page, take every
colour, border and radius from the client record or from `globals.css`.

## Filed Record

The client record's language, and the app's target. Named for what it is: the
record is assembled from public filings — Charity Commission, Companies House,
360Giving — and it should read as a filed document, not a dashboard widget.

The full reasoning is in the token block at `src/app/globals.css:60` and the
header of `section-card.tsx`. In short, three things were costing us:

1. **Borders you cannot see.** `border-black/[0.06]` resolves to #f0f0f0 on
   white — 1.06:1. White cards on a warm ground had no edges and the page read
   as grey mush. `--rule` is 1.35:1.
2. **Three darks at two colour temperatures** sitting next to each other
   (#1c1a18 warm, #0c1014 and #161b21 cool). `--ink` replaces all three.
3. **Text with no hue.** `--foreground: #414042` is dead grey. Ink tinted toward
   the ground stops the page looking cheap.

### Surfaces

```
border border-rule bg-white rounded-panel
```

That is the card. Three rules follow from it:

- **No shadow.** A visible border means the card no longer needs one to read as
  a card. Shadows are for things that *float* — popovers, dialogs, dropdowns —
  not for things that sit on the page. `shadow-sm` is in 92 files; none of them
  need it.
- **`rounded-panel` (10px), never `rounded-2xl`.** 10px reads as a document.
  16px reads as a 2021 app card. `rounded-inset` (6px) for controls and chips
  *inside* a card.
- **Insets are `bg-paper`, not another white card.** A nested white box on white
  needs a border to be visible, and a border inside a border is noise. Recessed
  content — a note, a hint block, a metadata chip — sits on `--paper` with
  `rounded-inset`. `--paper-sunk` is one step deeper, for the neutral pill only.

Internal dividers are `border-rule-soft`, one step lighter than `--rule`: the
card's own edge should be the strongest line on it.

### Type

`font-body` is Lato and is the app's voice. `--font-sans` (Geist) is the browser
default fallback; `--font-mono` (Geist Mono) is for values, not prose.

| Role | Spec |
| --- | --- |
| Page title | `font-body text-[clamp(2rem,4vw,2.75rem)] font-semibold leading-[1] tracking-[-0.03em] text-ink` |
| Section heading | `text-[18px] leading-[1.3] font-semibold tracking-[-0.01em] text-ink`, **sentence case** |
| Section numeral | `font-body text-[34px] leading-none font-light tabular-nums text-faint`, zero-padded, in an 11-unit gutter |
| Hint under a heading | `text-[13px] leading-[1.55] text-dim` — no width cap (see [Width](#width)) |
| Body | `text-sm leading-[1.65]` |
| Metadata row | `text-[13.5px] text-dim` |
| Register key | `font-mono text-[10.5px] font-medium tracking-[0.09em] text-faint uppercase` |

Three ink weights, and the distinction is meaning, not decoration: `--ink` is
content, `--dim` is context about content, `--faint` is furniture (icons,
separators, keys). Never set text as `text-foreground/40` — opacity on ink is
how the old system produced unreadable labels.

**Numbered sections.** There is no eyebrow style in this system; where a tab
needs one, the numeral is the hierarchy device. It sits in its own fixed-width
gutter to the left of the title — large enough to scan a page by, light enough
that it never competes with the words it labels, and a fixed width so every
title on the tab starts on the same column whether its number is one digit or
two. A hairline closes the title off from its hint. `SectionCard` renders this
automatically from its `number` prop; unnumbered cards are unaffected, and
`financials/section-unavailable.tsx` mirrors the same gutter so an empty section
lines up with a full one. Numbers are opt-in per tab and must be **stable
addresses** — "look at 3" has to mean the same question on every record — so a
section with no data keeps its number rather than letting 4 become 3.

**Uppercase + letter-spacing appears in exactly one place**: `<Key>`, for things
that genuinely are codes — `UK CHARITY`, `PRIORITY`, `OWNER`. It is not a
heading style. The old `text-[11px] font-bold uppercase tracking-[0.12em]
text-foreground/40` label is the app's most-copied mistake (49 files) — caps at
40% opacity is unreadable *and* shouting, and it made every card on every screen
read as the same anonymous widget. Do not add a fiftieth.

### Colour

One structural accent, four states, and they do different jobs — the accent
tells you *where you are*, the state tells you *what is true*. Keeping them
separate is why `--lead` is not green.

**`--lead`** (#23407a) is the accent, and it appears in four places only: the
active tab, links, the focus ring, and register keys. Buttons are `--ink`.

**States** are `go` / `hold` / `stop` / `neutral`, each with a `-wash` for its
fill. Use the `<Pill>` component rather than assembling one — it carries a dot
as well as a colour, so the state survives a greyscale print and a red-green
colour deficiency. Before Pill there were five hardcoded palettes on the record
plus borrowed `amber-500` and `red-800` from Tailwind's ramp.

The 180DC green survives as **`--go` only**. `--brand` (#72b744) is 2.3:1 on
white and unusable as text; `--go` is the retuned 4.9:1 version. `--brand` stays
for the logo and the public system. Never as app text.

**Never reach into Tailwind's colour ramp.** `emerald-800`, `amber-500`,
`zinc-*` are all outside this system. If a state needs a colour, it is one of
the four tones.

### Icons

Inline, at the title's baseline, in `text-faint`, sized 15px, and **only where
they disambiguate one row from another**. No icon tiles — `size-8 rounded-xl
bg-black/[0.04] ring-1 ring-black/[0.05]` around a 16px glyph is the most
templated component of the last three years, and a decorative icon on every
heading is noise that costs a scan.

### Motion

The one thing that should read as the same product across the public site and
the app. Content arrives in reading order, blurring up, never all at once.

Use `Stage` / `Group` / `Rise` from `src/components/dashboard-stage.tsx`. They
wrap the shared brand variants rather than redeclaring them, and `Stage` owns
the reduced-motion contract — one per screen.

Two traps, both already paid for:

- `entranceSoft` settles on `filter: blur(0px)`, and **any** non-none filter
  opens a containing block. That breaks `position: sticky` on every descendant,
  so a sticky tab bar must sit *outside* `Stage` (see
  `clients/[id]/layout.tsx`). It also makes the element a permanent backdrop
  root, so `backdrop-blur` inside can only ever sample that card — `Rise`
  clears the filter to `none` on animation complete for this reason.
- Long lists use `entranceIndexed`, not `stagger`. A hundred rows at 0.04s apart
  is a four-second cascade.
- **Read reduced motion with `useReducedMotionConfig`, never `useReducedMotion`.**
  The in-app Motion setting (Settings → Accessibility) reaches Motion through
  the single `MotionConfig` in `AccessibilityProvider`. `useReducedMotion` only
  sees the OS setting and ignores it, and a nested
  `<MotionConfig reducedMotion="user">` overrides it back to OS-only — don't add
  either.

### Page shell

```jsx
<div className="min-h-screen max-w-full overflow-x-hidden bg-[#f4f4ef] px-4 py-8 sm:px-8 sm:py-10 xl:px-12 xl:py-12">
  <div className="mx-auto w-full max-w-[1400px] space-y-6">
```

Content on the ground with white cards on it — not one box holding everything.
`space-y-6` between sections on a record, `space-y-10` on the dashboard where
sections are heavier.

### Width and horizontal space

**Horizontal space is whatever the dashboard page uses** (`src/app/(app)/dashboard/page.tsx`).
The page container is bounded and centered at `mx-auto w-full max-w-[1400px]`,
preventing content from stretching endlessly on wide monitors while keeping standard responsive padding
(`px-4 py-8 sm:px-8 sm:py-10 xl:px-12 xl:py-12`) on the outer shell (`max-w-full overflow-x-hidden`).

Within that 1400px container:
- Content fills the full width of the column the shell gives it.
- **Do not use ad-hoc `max-w-*` on individual cards, hints, or paragraphs** (e.g. `max-w-[54ch]`, `max-w-2xl`, `max-w-sm`). A capped hint under a full-width card title leaves a ragged hole on the right.
- The one exception is something that genuinely floats — a dialog, popover or dropdown — whose width is the component's own, not the page's.

Routes under `AppShell` render a `div`, not a `main` — the shell already renders
the `main` they slot into.

## Open question: the ground

Unresolved, and it needs a decision before a wide conversion.

`globals.css:74` states the ground moves off warm bone `#f4f4ef` to cool filing
stock, "because the record is assembled from public filings and cool grey gives
white something to sit against". **That move never happened.** Both the dashboard
and the client record still hardcode `bg-[#f4f4ef]`, and `--paper` is in use as
an *inset* fill inside cards rather than as the page ground.

So the app currently has three grounds: bone `#f4f4ef` (hardcoded, ~20 files),
`#f1f2f4` (stale, admin pages), and `--paper` #ebedf0 (insets).

Either answer is fine; the cost is having no answer:

- **Keep bone.** Then it becomes `--ground` in `globals.css`, the insets keep
  `--paper`, and the comment at `globals.css:74` gets corrected.
- **Go cool.** Then `--paper` is the ground, insets move down to
  `--paper-sunk`, and a new step is needed below that.

Until this is settled, use `bg-[#f4f4ef]` and do not invent a fourth.

## Dark mode

Deferred, deliberately. The app is light-only: no `.dark` class is set anywhere,
no toggle, no dark palette.

`globals.css:19` rebinds Tailwind's `dark:` variant from
`@media (prefers-color-scheme: dark)` to an explicit `.dark` ancestor that
nothing sets. This is load-bearing — it neutralises every stray `dark:` class
that arrives with a pasted component. Without it, a pasted control renders
near-black on a bone card for anyone whose OS is in dark mode, which is how the
Add Note trigger shipped broken.

Do not add `dark:` classes. Do not add a toggle without doing the whole thing:
put `.dark` on `<html>` and define token overrides under it.

## Components

`src/components/ui/` holds several components that do the same job. Defaults:

| Job | Use |
| --- | --- |
| Card / section | `SectionCard` from `clients/[id]/section-card.tsx` |
| Status marker | `Pill`, same file |
| Code label | `Key`, same file |
| Entrance | `Stage` / `Group` / `Rise` |
| Checkbox | `FiledCheckbox` from `src/components/ui/filed-checkbox.tsx` |
| Instant on/off | `Switch` from `src/components/ui/material-design-3-switch.tsx` |
| Pick one of a few (settings) | `OptionGroup` from `src/app/settings/option-group.tsx` |
| A tag | `TagChip` from `src/lib/tags/tag-chips.tsx` |
| A reading's shape | The sticks — `HorizontalStickGauge`, `StackedStickColumns` |

**A tag is one chip, everywhere.** `TagChip` is the tag as it appears on the
client record, on the tags screen's list and inside its colour picker: a
rectangle cut with an 8px V notch (`TAG_NOTCH_CLIP`), tinted with the tag's own
colour, or `bg-paper-sunk text-ink` when it has none. The colour palette is the
one exception to "never a colour of your own" — it is data the team chose, and
every entry is ≥4.5:1 as text on its own tint (`src/lib/tags/tag-colours.ts`).
**"No colour" is neutral, never green**: a tag is the one thing a person picks
the colour of, so choosing nothing must not arrive as `--brand`, which is not an
app colour at all. Before this, the record drew a notched brand-green chip and
the admin list drew a `rounded-full` pill in a second, different brand tint.
Picking a colour is `OptionGroup`'s problem in miniature — real radios — but the
control that shows the choice is the chip itself, so you pick by looking at the
result (`admin/tags/colour-picker.tsx`).

**Checkboxes are always `FiledCheckbox`** — the animated animate-ui checkbox
(the one on the Terms & Conditions step, where the tick draws itself in),
checked in `--lead`. Never a native `<input type="checkbox">`, and never
`accent-brand` or any `accent-*`: the native control ignores the tokens and
looks different in every browser. It renders a `<button>`, so give it an `id`
and a `<label htmlFor>`; wrapping it in a label alone is not enough.

**Pick-one choices are real radios.** `OptionGroup` is a `fieldset` of native
radios styled as cards — grouping, arrow keys and one tab stop come from the
browser. Never a row of `<button role="radio">`.

**An instant on/off is `Switch`, not a checkbox.** The two controls mean
different things and a screen that mixes them up lies to people: a checkbox
answers a question that is submitted with the form, a switch *is* the save.
Material Design 3's physics are in `material-design-3-switch.tsx` (spring knob,
morphing handle, halo) but the colours are this system's — `primary` is `--lead`,
`success` is `--go`, and `destructive` is `--stop`, which is the one to use where
turning the switch off is the risky direction (`data-handling-rules` turns a
privacy protection off that way). Its `haptic` prop plays a synthesised click;
nothing in the app sets it, and nothing should without asking first — a setting's
state must never depend on the sound card.

**The sticks are the app's instrument.** `HorizontalStickGauge` (a share of a
whole), `StackedStickColumns` (the last seven buckets, beside a numeral) and
`stick-slider` (a value you set) all draw the same object — a 3px rounded
stroke in `--lead`, spaced at the gauge's 8.5px pitch — and a card that needs a
shape of its own should join them rather than invent one
(`dashboard/ai-spend-daily-chart.tsx` is the worked example: spend as one
vertical stick gauge per date, the same reading as the horizontal one stood on
its end). Where the instrument is a share, the pitch is fixed; where it is a
time series, the *dates* set the pitch and only the stroke has to give way, and
only once the dates would otherwise overlap. Three rules keep them one family:

- **Measure the width; never scale a `viewBox`.** A fixed `viewBox` the browser
  fits to the card means one SVG unit is *not* one CSS pixel, so an instrument
drawn for a one-column tile arrives stretched the moment its card takes two
  columns — 4px sticks become 14px blocks, and the whole card reads as a cruder
  object than the one next to it. `HorizontalStickGauge` measures its container
  with a `ResizeObserver` and draws in pixels; anything carrying a time series
  should do the same.
- **Colour is the accent, or the data's own palette — never a state tone.** A
  category is not good or bad, so it must not be drawn in `go`/`hold`/`stop`;
  those mean state, and state comes from `Pill`. A category's five colours live
  with its labels (`lib/dashboard/ai-spend.ts`), so the instrument, its legend
  and the next screen that shows the same split agree.
- **One category per mark — except a date's own stick.** A mark is 3px, so a
  split that matters gets a row of its own (`AiSpendActivityGauge`), and the
  per-day detail used to live on hover alone. The spend-by-day chart is the
  exception: each date is one vertical stick whose height is that date's spend
  against the dollar axis, split bottom-up into one segment per kind of work in
  the gauge's colours. A dot too small to split takes its busiest kind's colour
  instead, and the full breakdown stays on hover.

`origin-button`, `gooey-action-button`, `send-button`, `gooey-email-input` and
the other gooey/animated variants are one-off brand pieces, not app defaults.
Reach for them only where a screen is deliberately expressive.

## Converting an old screen

In rough order of visual payoff:

1. `border-black/[0.06]` → `border-rule`, and drop the `shadow-sm` that went
   with it.
2. `rounded-2xl` → `rounded-panel`; `rounded-xl`/`rounded-lg` on inner controls
   → `rounded-inset`.
3. `text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/40`
   headings → `text-[18px] font-semibold text-ink`, sentence case. Uppercase
   only survives where the thing is a code, and then it's `<Key>`.
4. `text-foreground/NN` → `text-ink` / `text-dim` / `text-faint` by role.
5. Tailwind ramp colours → the four state tones, via `Pill` where it's a status.
6. Hardcoded hex → the token.

Convert a whole screen at a time. A half-converted page reads worse than either
version of it, because the two borders sit side by side.
