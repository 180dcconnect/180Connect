# 180Connect design system

The visual language established by the landing page (`src/components/landing.tsx`)
and the menu sheet. Every public-facing surface — landing, legal, login, and the
marketing chrome around the app — is built from it.

## Source of truth

Anything expressible in code lives in **`src/components/brand/`** and that code is
authoritative. Import it; do not re-declare colours, easing curves, or variants in
a page file. Two hand-copied versions of a token drift the moment one gets fixed —
this has already happened once (the CTA wash hairline fix landed on the landing
page and never reached the legal page).

This document carries what code cannot: intent, and the reasoning behind choices
that look arbitrary until you know why.

| Need | Where |
| --- | --- |
| Colour, easing, timing values | `src/components/brand/tokens.ts` |
| Entrance / hover variants | `src/components/brand/motion.ts` |
| The CTA, wordmark, menu sheet | `src/components/brand/*.tsx` |
| Which to use, and when | this file |

The **app** (`/dashboard`, `/admin`, `/clients`, …) is deliberately not held to
this. It is a dense internal tool and uses the shadcn tokens in `globals.css`.
This system governs everything a visitor sees before they log in.

## Character

Editorial, not SaaS-template. The reference points are a design studio's site,
not a dashboard product page.

- **Big type, small chrome.** Display type runs to `clamp(2.5rem, 8vw, 5.5rem)`
  at weight 900. Supporting text is 12–15px. There is no in-between size — the
  jump is the effect.
- **Bone, not white.** The page ground is `#f4f4ef`. Pure white reads clinical
  against the photography and is reserved for cards floating above the ground.
- **One accent, used sparingly.** Pale lime `#e6f5c0` marks exactly one action
  per screen. If two things on a page are lime, one of them is wrong.
- **Photography is texture, not illustration.** Leaf crops are scattered,
  partially blurred, and drift; they sit behind content and are allowed to run
  off the edge. Never a neat grid of images.
- **Motion is staged, never simultaneous.** Things arrive in reading order and
  hover effects run as a chain. Everything moving at once reads as a template.

## Colour

```
#f4f4ef  ground      page background, and text on ink
#0c1014  ink         menu sheet, display headings, burger bars
#1c1a18  ink-warm    hero headline only (a hair warmer than ink)
#e6f5c0  lime        the accent — CTA disc and wash
#72b744  brand       the 180DC globe green; logo and app UI only
rgba(28,26,24,0.72)  glass    CTA capsule at rest
rgba(255,255,255,0.25)  rim   ring on any glass surface
inset 0 1px 0 rgba(255,255,255,0.3)   lip   lit top edge on glass
```

Text on the bone ground is ink at an opacity, not a separate grey:
`/55` for body copy, `/40` for meta, `/35` for muted, `/30` for labels.
On the ink sheet the same trick runs with ground: `#f4f4ef/60`, `/40`.

`--brand` `#72b744` is the *organisation's* green and belongs on the logo and
inside the app. It is not the landing accent — lime is. Do not fill a marketing
button with `#72b744`.

### Glass

Glass is three things together, and it falls apart if you drop one:

1. a translucent dark background (`glass`),
2. `ring-1 ring-white/25`,
3. `boxShadow: LIP` — a 1px inset white highlight along the top edge.

`backdrop-blur-md` is added **only where something sits behind it** to blur. On
the flat ink sheet there is nothing to pick up, so the sheet's CTA drops the blur
and raises its background tint instead (`rgba(244,244,239,0.08)`).

72% is not arbitrary: it is the lowest opacity that keeps the cream label above
4.5:1 against the bone page.

## Typography

Both faces are already wired in `layout.tsx`.

- **`font-body` (Lato)** — everything on public surfaces, including headlines.
  Display: `font-black`, `tracking-[-0.03em]`, `leading-[1.05]`.
- **`font-sans` (Geist)** — headings inside the app.
- **`font-mono`** — reserved; not currently used on public pages.

| Role | Spec |
| --- | --- |
| Hero headline | `clamp(2.25rem,6vw,4.5rem)` / 900 / `-0.03em` / 1.05 |
| Menu link | `clamp(2.5rem,8vw,5.5rem)` / 900 / `-0.03em` / 1.05 |
| Page title | `clamp(2.75rem,6vw,5rem)` / 900 / `-0.035em` / 0.95 |
| Section heading | `text-2xl sm:text-3xl` / 900 / `-0.02em` |
| Body copy | `text-[15px]` / `leading-[1.8]` / ink `/55` |
| Eyebrow / label | `text-[11px]` / bold / `uppercase` / `tracking-[0.12em]` |
| UI label, pill | `text-xs sm:text-sm` / medium |

Numbers in a list or table take `tabular-nums`, zero-padded (`01`, `02`).

## Shape

- **Pills for actions.** `rounded-full`, always. A marketing button is never a
  rounded rectangle.
- **`rounded-2xl` for cards** floating on the ground; `rounded-xl` for media.
- **Dividers** are `h-px` at ink `/6`; borders at ink `/8` or `/10`.
- **No drop shadows** except `shadow-sm` on a floating card. Depth comes from
  the glass rim and lip, not from a shadow.

## The CTA

The signature component. Two capsules — a label pill and a disc — meeting at a
single tangent point, not merged into one shape. The lens-shaped slivers above
and below where they touch are the whole point; do not close the gap.

Sizes: `h-10` / `w-10` disc for a hero, `h-9` / `w-9` for the nav and sheet.

Hover runs as a **chain**, and the ordering is the effect:

1. `0.00s` the disc's dark ring shrinks to nothing (`CTA_FILL`, 0.22s)
2. `0.22s` lime washes leftward across the label pill (`CTA_WASH`, 0.38s)
3. `0.32s` the label flips cream → ink, once the wash is under it
4. `0.22s` the arrow darts out the right edge and re-enters from the left

Leaving hover reverses all of it at once, quickly (~0.25s). The whole link also
lifts `-2px` on a spring (`stiffness: 420, damping: 28`).

The arrow's dart is one arrow travelling through, not two: it animates
`x: [0, 26, -26, 0]` with `times: [0, 0.45, 0.4501, 1]`, so the jump across
happens in one frame while it is outside the disc's `overflow-hidden` clip.

### Rendering gotchas — do not "clean these up"

Both cost real debugging time. They look like mistakes and are not.

**The wash overshoots.** The wash block is `-inset-y-[1px]` (not `inset-y-0`) and
settles at `left: "-20%"` (not `0%`). Its `rounded-l-full` cap and the parent's
`overflow-hidden` clip are two independently antialiased curves; Chrome
subpixel-rounds them a hair apart and the dark glass shows through as a hairline
even when the radii are nominally identical. Overshooting guarantees the parent's
clip — not a near-miss between two curves — draws the edge.

**The disc's ring is an inset shadow, not a gradient or a child.** Stacked
children are each antialiased against the rounded clip independently, which
composites a dark hairline at the edge that no overshoot removes. An inset shadow
rasterises with the background, so the element has exactly one antialiased edge.

## Motion

One curve for everything: `EASE = [0.2, 0.7, 0.2, 1]`. Two exceptions, both
deliberate:

- the **menu sheet's** circle uses `[0.76, 0, 0.24, 1]`, which eases *in* so the
  small disc is visible under the burger before it expands;
- the **auth dialog** rides the animate-ui primitive's spring
  (`stiffness: 150, damping: 25`) and its 3D flip.

**Entrance** is always opacity + a short rise + a blur-up. Blur is what makes it
feel like the brand rather than a generic fade:

```
hidden: { opacity: 0, y: 14, filter: "blur(12px)", scale: 0.98 }
show:   { opacity: 1, y: 0, filter: "blur(0px)", scale: 1 }
duration 0.75s, staggerChildren 0.09
```

Elements arrive in reading order. A group of related items (nav links, sections)
staggers `0.04`–`0.09` apart. Nothing snaps in.

**Every public page wraps in `<MotionConfig reducedMotion="user">`.** Transforms
drop for anyone who asks; opacity fades survive, so the page still resolves rather
than appearing instantly.

Hydration note: pass motion values through `useMotionTemplate` rather than as a
bare `y`/`x`. Motion applies transform shorthands imperatively via ref, skipping
React's render tree, which desyncs from SSR output and trips a mismatch.

## Chrome

Every public page carries the same top bar, and the geometry is shared so the
elements land in identical positions across routes:

- Gutters `px-6 py-6` → `sm:px-10 sm:py-8`
- Wordmark top-left; burger top-right at `mr-4` / `sm:mr-8`, `h-11 w-11`
- Nav CTA parked at `right-[68px]` / `sm:right-[86px]`, `mt-6` / `sm:mt-8`

The burger is three 2px bars that fold into an X — outer bars converge and cross,
middle bar fades. It sits at `z-50`, above the sheet, so it stays clickable.

**The menu sheet** opens as a circle from `95% 5%` (under the burger) and swells
to `circle(150%)`, engulfing the screen in ink. The sheet's own wordmark and CTA
sit at exactly the same coordinates as the ones underneath, with no entrance
animation of their own — the clip-path reveal is the only thing that makes them
appear, so opening the menu reads as those elements *recolouring*, not as one set
leaving and another arriving. If you move a chrome element, move both copies.

Escape closes the sheet. Body scroll locks while it is open.

## Signing in

There is no login *page* and no reset-password page. Nobody signs up — accounts
are created by an admin — so there is no funnel to land in. Both live as panels
of one dialog (`src/components/auth-dialog.tsx`) that opens over whichever public
page you are already on.

Any public page can host it: pass `useAuthDialog().openSignin` to
`<SiteChrome onCtaClick>`. `SiteChrome` renders the dialog itself, because it is
the only thing that knows whether the ink sheet is up — which is what decides the
dialog's tone. A page that leaves `onCtaClick` off keeps a plain link to `/login`.

**`/login` and `/forgot-password` are still routes and must stay.** Eight places
redirect to them and two carry a notice in the query string:

| Source | Target |
| --- | --- |
| `src/lib/supabase/session-guard.ts` | `/login?signed_out=expired` |
| `src/lib/auth/logout.ts` | `/login?signed_out=1` \| `=error` |
| `src/app/reset-password/actions.ts` | `/login?password-reset=success` |
| `dashboard`, `profile`, `app-shell`, `admin-route` guards | `/login` |
| `src/lib/auth/password-reset.ts` | both, on the not-trapped allowlist |

Each renders the landing page with the dialog already open on the matching panel,
the notice passed in, and the splash intro skipped — someone bounced here by an
expired session is waiting to log in, not watching a title sequence.

### The URL is the state

`usePathname()` decides which panel is showing, so nothing can hold a second,
disagreeing copy — which is also why `useAuthDialog()` can be called from both
the chrome and a hero button on the same page.

- **Opening** calls `window.history.pushState`, not `router.push`: a real
  navigation would remount the host page, restarting the landing's intro or
  throwing away a legal page's scroll position. Next syncs `usePathname` with raw
  history calls.
- **Switching panels** *replaces* that entry rather than pushing another, so one
  dialog session is one history entry however many times someone bounces between
  "Forgot password?" and "Back to log in".
- **Closing** rewinds with `history.back()` if we pushed, or `replaceState("/")`
  if the visitor arrived on an auth route directly, so Back never lands them
  straight back in the dialog.

All four close paths — X, Escape, overlay, Back — must work, and closing must
leave the host page exactly as it was.

### Opening over the menu

The sheet's own pill does **not** dismiss the sheet first. The dialog opens on
top of it in `dark` tone: a raised ink panel (`INK_RAISED`) with a white rim, so
it joins the sheet's world rather than punching a bright hole in it. Close it and
the menu is still there.

That layering costs one piece of plumbing. Radix dismisses on Escape from a
*capture*-phase listener, and React flushes discrete events synchronously — so by
the time the sheet's own Escape handler runs, the dialog has already closed and
the URL has already reverted. No state check can tell that the keypress was
spoken for. The dialog therefore marks the event itself (`markEscapeHandled`) and
the sheet checks the mark (`wasEscapeHandled`). Without it one press closes both.

### Animation

Presence, portalling, and the entrance come from
`@/components/animate-ui/primitives/radix/dialog`, installed with
`npx shadcn@latest add @animate-ui/components-radix-dialog`. The panel flips in
on a perspective `rotateX` from `-20deg` at `scale(0.8)`, blurring up, on a
spring; the overlay blurs in behind it. Only the surface is ours.

The close button uses the animate-ui `X`
(`npx shadcn@latest add @animate-ui/icons-x`), whose two lines rotate 90° a beat
apart on hover. It is wrapped in `<AnimateIcon asChild>` so the *button* is the
trigger — bound to the glyph, the 32px button's padding would be dead to it.

That install also writes `animate-ui/components/radix/dialog.tsx`, the
shadcn-*styled* wrapper. It is deliberately unused: it carries the app's neutral
card look (`bg-background`, `rounded-lg`, a border) rather than this system's.
Take the primitive, not the wrapper.

Because the primitive keeps the panel mounted through its exit animation, the
copy and the form have to survive `view` going `null` — the dialog holds the last
open view in state, adjusted during render, so closing never blanks the panel for
the length of the exit.

### Tone

`light` (bone panel, the default) and `dark` are declared as one table in
`auth-dialog.tsx` so a tone cannot end up half-applied, and the field styles both
forms share live in `src/components/brand/fields.ts`.

Floating labels sit *across* a field's top border and have to paint the panel's
own colour behind themselves to cut the line — a colour the field cannot know. So
the panel publishes `--field-notch`, `--field-label`, `--field-label-focus`, and
`--field-placeholder`, and the label reads them (`fieldVars`). The fallbacks are
the bone page, so a field dropped anywhere else still looks right.

Radix focuses the first tabbable node, which is the close button. The dialog
overrides `onOpenAutoFocus` to put focus in the email field, and re-claims it
when the panel switches — switching unmounts whatever had focus, which otherwise
drops it back to the panel and paints the UA's focus ring around the whole thing.

## Imagery

Leaf crops in `public/crops/` are pre-cut with a leaf silhouette baked into the
PNG alpha (two opposite corners swept, two sharp) — not a CSS `border-radius`, so
a blurred crop dissolves along the leaf edge instead of being hard-cut.

Scatter rules: crops enter in waves by vertical band, upper ones drifting in from
the left and lower ones from the right so the group converges as it lands. Once
settled they keep a slow idle sway, seeded off the index rather than `Math.random`
so there is no hydration mismatch. A few stay at `blur(4px)` permanently — that is
depth of field, and it is what stops the scatter reading as a gallery.

Regenerate crops with `scripts/` (see `public/crops/`), never by cropping in CSS.

## Checklist for a new public page

- [ ] `bg-[#f4f4ef]`, wrapped in `<MotionConfig reducedMotion="user">`
- [ ] Chrome imported from `src/components/brand/`, not copied
- [ ] Display type in Lato 900 with negative tracking
- [ ] Exactly one lime CTA
- [ ] Content enters staggered, blur-up, in reading order
- [ ] Focus rings present: `focus-visible:outline-2 outline-offset-4`
- [ ] Checked at 375px, 768px, 1440px

## Don't

- Don't fill a marketing button with `#72b744`, or use `rounded-lg` on one.
- Don't put pure white behind body copy on a public page.
- Don't add a second accent colour, or a drop shadow for depth.
- Don't animate everything at once, or drop the blur from an entrance.
- Don't copy a variant or hex out of `brand/` into a page file.
- Don't reach for shadcn defaults here — they are for the logged-in app.
