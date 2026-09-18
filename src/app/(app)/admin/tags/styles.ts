/**
 * The three client components on the tags screen share these, the same way
 * `src/app/settings/styles.ts` shares the settings cards' tokens.
 *
 * The shapes are the Data imports screens' own (`import-console.tsx`'s New
 * import, `annual-return-card.tsx`'s backfill): `rounded-inset` controls, a
 * `--lead` solid for the one action a card exists for, an outline for the rest,
 * `--rule` hairlines and a `--lead` focus ring. Nothing here invents a value —
 * see `docs/app-design-system.md` §Components.
 */

/** The card's own action: create the tag. */
export const PRIMARY_BUTTON =
  "inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-inset border border-lead bg-lead px-3 py-2 text-[13px] font-medium text-white transition-colors hover:bg-lead-mid focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lead/30 disabled:pointer-events-none disabled:opacity-50";

/** Anything that is not the card's own action: Keep it, Cancel, Save. */
export const SECONDARY_BUTTON =
  "inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-inset border border-rule bg-white px-2.5 py-1.5 text-[13px] font-medium text-ink transition-colors hover:border-lead/40 hover:bg-lead-wash focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lead/30 disabled:pointer-events-none disabled:opacity-50";

/** A tag's name, while it is being renamed. */
export const TEXT_FIELD =
  "h-10 w-full rounded-inset border border-rule bg-white px-3 text-sm text-ink outline-none transition-[border-color,box-shadow] placeholder:text-faint focus-visible:border-lead focus-visible:ring-2 focus-visible:ring-lead/20 focus-visible:outline-none disabled:opacity-50";

/**
 * A row's action. `--lead` because these are the record's links and actions;
 * the delete is `--stop`, the one destructive thing on the screen.
 */
export const ROW_ACTION =
  "cursor-pointer rounded-inset px-2 py-1 font-body text-[13px] font-medium text-lead transition-colors hover:bg-lead-wash focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lead/30 disabled:pointer-events-none disabled:opacity-50";

export const ROW_ACTION_STOP =
  "cursor-pointer rounded-inset px-2 py-1 font-body text-[13px] font-medium text-stop transition-colors hover:bg-stop-wash focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stop/30 disabled:pointer-events-none disabled:opacity-50";

/** A row's own error line, under the tag it belongs to. */
export const ROW_ERROR = "font-body text-[13px] text-stop";
