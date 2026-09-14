/**
 * The class strings the settings cards share, so Profile & account and
 * Accessibility cannot drift into slightly different cards.
 *
 * Filed Record tokens throughout (`docs/app-design-system.md`); the card and
 * its action zone follow `admin/charity-commission/annual-return-card.tsx`,
 * and the primary button is the same lead button as `NewImportButton`.
 * No `max-w` anywhere — see the design doc's "Width" rule.
 */

export const CARD = "rounded-panel border border-rule bg-white px-5 py-5 sm:px-6";

export const CARD_TITLE =
  "font-body text-[19px] leading-[1.3] font-normal tracking-[-0.01em] text-ink";

export const CARD_HINT = "mt-1.5 text-[13px] leading-[1.55] text-dim";

export const ROW =
  "flex flex-wrap items-baseline justify-between gap-x-8 gap-y-1 border-t border-rule-soft py-3.5";

export const FIELD_LABEL = "text-[13px] font-medium text-dim";

export const FOOTNOTE = "text-[13px] leading-[1.55] text-dim";

export const INPUT =
  "h-10 w-full rounded-inset border border-rule bg-white px-3 text-sm text-ink outline-none focus-visible:border-lead focus-visible:ring-2 focus-visible:ring-lead/20 aria-invalid:border-stop";

/**
 * The custom dropdown (`@/components/ui/select`) dressed as a Filed Record
 * control — same height, border and focus ring as `INPUT`.
 */
export const SELECT_TRIGGER =
  "h-10 w-full cursor-pointer rounded-inset border border-rule bg-white px-3 text-sm text-ink shadow-none focus-visible:border-lead focus-visible:ring-2 focus-visible:ring-lead/20 data-[placeholder]:text-faint aria-invalid:border-stop";

export const SELECT_CONTENT = "rounded-inset border border-rule bg-white shadow-md";

export const SELECT_ITEM =
  "cursor-pointer rounded-[4px] py-2 text-sm text-ink focus:bg-paper focus:text-ink";

export const SELECT_GROUP_LABEL = "px-2 pt-2 pb-1 text-[12px] font-medium text-faint";

export const PRIMARY_BUTTON =
  "inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-inset border border-lead bg-lead px-2.5 py-1 text-[13px] font-medium text-white transition-colors hover:bg-lead-mid focus-visible:ring-2 focus-visible:ring-lead/30 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50";

export const QUIET_BUTTON =
  "inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-inset px-2.5 py-1 text-[13px] font-medium text-dim transition-colors hover:bg-paper hover:text-ink focus-visible:ring-2 focus-visible:ring-lead/30 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50";

/** The in-row "Edit" / "Change" link — lead, because it is a link-weight action. */
export const ROW_ACTION =
  "cursor-pointer rounded-inset px-2 py-0.5 text-[13px] font-medium text-lead transition-colors hover:bg-lead-wash focus-visible:ring-2 focus-visible:ring-lead/30 focus-visible:outline-none";
