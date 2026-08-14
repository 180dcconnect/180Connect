/**
 * The public-facing palette — landing, legal, login, and any marketing surface.
 * See docs/design-system.md for what each one is for and when not to use it.
 *
 * These are plain constants rather than Tailwind theme entries because most are
 * consumed as inline `style` values inside Motion variants, where a class name
 * is no use. The few that also need to exist as utilities (the ground, the ink)
 * are written as literal arbitrary values at the call site — Tailwind only sees
 * class strings it can scan, so `bg-[${GROUND}]` would silently produce nothing.
 *
 * Deliberately separate from the shadcn tokens in globals.css: those dress the
 * logged-in app, which is a dense internal tool and does not follow this system.
 */

/** Page background. Bone, not white — white reads clinical against the photography. */
export const GROUND = "#f4f4ef";

/** Menu sheet, display headings, burger bars. */
export const INK = "#0c1014";

/** The hero headline only; a hair warmer than INK against the leaf crops. */
export const INK_WARM = "#1c1a18";

/**
 * A surface that has to sit *on top of* the ink sheet and still read as a
 * separate plane — the auth dialog when it opens over the menu. Flat INK would
 * vanish into the sheet; this is the smallest lift that reads as raised once the
 * white rim and the dimmed overlay are doing their share.
 */
export const INK_RAISED = "#161b21";

/**
 * The accent. One lime element per screen — it marks the single action that
 * matters. Not to be confused with `--brand` (#72b744), which is the 180DC
 * organisation green and belongs on the logo and inside the app.
 */
export const LIME = "#e6f5c0";

/**
 * Rest state of a CTA capsule. 72% is the lowest opacity that still keeps the
 * cream label above 4.5:1 against the bone page.
 */
export const GLASS = "rgba(28, 26, 24, 0.72)";

/**
 * The lit top edge that sells glass: a one-pixel inset highlight, the way a pane
 * catches light on its upper rim. Kept on through hover so a capsule and its
 * disc never lose their edge at different moments.
 */
export const LIP = "inset 0 1px 0 rgba(255, 255, 255, 0.3)";

/**
 * Stands in for GLASS on the menu sheet. The sheet is flat ink with nothing
 * behind it, so `backdrop-blur` has nothing to pick up and the charcoal glass is
 * near-invisible against it — a faint light tint keeps the capsule readable and
 * gives the wash something to travel over.
 */
export const SHEET_TINT = "rgba(244, 244, 239, 0.08)";

/** Label colour at rest on both tones; flips to INK once the wash is under it. */
export const LABEL_REST = "#f4f4ef";
