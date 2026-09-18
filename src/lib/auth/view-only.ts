/**
 * The signal that tells a viewer's browser a write was just refused.
 *
 * Viewers see every screen and can press every button; the server refuses the
 * write itself (getCurrentActor, then RLS underneath it). The refusal has to
 * reach the person as one clear notice, but writes arrive through ~70 server
 * actions and ~30 API routes, each rendering its own errors its own way.
 * Wiring a dialog into every one of them would be a hundred edits and would be
 * forgotten on the hundred-and-first.
 *
 * Instead the refusal travels on the response: getCurrentActor sets this
 * short-lived cookie whenever it refuses a viewer, and ViewOnlyNotice (mounted
 * once per shell, for viewers only) checks for it after every request and opens
 * the notice. A new action gated by getCurrentActor gets the notice for free.
 *
 * Not a security control — it carries no identity and grants nothing. Deleting
 * or forging it changes only whether a notice appears.
 */
export const VIEW_ONLY_REFUSED_COOKIE = "view-only-refused";

/** Long enough to survive a slow response; short enough never to show twice by surprise. */
export const VIEW_ONLY_REFUSED_MAX_AGE_SECONDS = 60;

export const VIEW_ONLY_MESSAGE =
  "You have view-only access, so you can look at everything but cannot change anything. Nothing was saved or sent. If something needs doing, ask an admin.";

/**
 * The line a screen shows where a control would have been, when that control is
 * withheld from a viewer.
 *
 * Withholding the control is not enough on its own: a card with its button
 * missing, or a queue with no way to answer it, reads as broken or as a
 * permission the screen forgot to explain. So every screen that hides a control
 * says the same sentence in its place — one voice, one reason, no gap for the
 * reader to interpret. Use it as-is; only the wording of the *job* around it
 * belongs to the screen.
 */
export const VIEW_ONLY_CONTROL_NOTE =
  "Your access is view-only, so you can read this but not change it.";

export const VIEW_ONLY_EVENT = "view-only-notice:open";

/**
 * Triggers the ViewOnlyNotice dialog immediately on the client (e.g. when a viewer
 * clicks Compose or another action that has no server roundtrip).
 */
export function triggerViewOnlyNotice(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(VIEW_ONLY_EVENT));
  }
}
