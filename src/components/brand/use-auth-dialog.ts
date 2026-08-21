"use client";

import { usePathname } from "next/navigation";
import { useCallback, useRef } from "react";

/** Which panel the auth dialog is showing, or `null` when it is closed. */
export type AuthView = "signin" | "forgot";

const ROUTES: Record<AuthView, string> = {
  signin: "/login",
  forgot: "/forgot-password",
};

/**
 * Owns the auth dialog's open state and which of its two panels is showing.
 *
 * The URL *is* the state — no copy in React to fall out of step with it, which
 * is also why this can be called from more than one component on a page (the
 * chrome that renders the dialog, and a hero button that opens it) without the
 * two ever disagreeing. Next syncs `usePathname` with raw history calls, so the
 * back button closes the dialog for free and both routes behave the same however
 * they were reached. See docs/design-system.md § Signing in.
 */
export function useAuthDialog() {
  const pathname = usePathname();
  const view: AuthView | null =
    pathname === ROUTES.signin
      ? "signin"
      : pathname === ROUTES.forgot
        ? "forgot"
        : null;
  /** Whether *we* pushed the auth route, which decides how closing unwinds it. */
  const pushedRef = useRef(false);

  /**
   * Opening pushes one history entry; switching panels *replaces* it. One entry
   * for the whole dialog session, however many times someone bounces between
   * "Forgot password?" and "Back to log in" — so Back always means "close this
   * and give me the page I was on", never a walk back through the panels.
   */
  const show = useCallback(
    (next: AuthView) => {
      if (view === null) {
        window.history.pushState(null, "", ROUTES[next]);
        pushedRef.current = true;
      } else if (view !== next) {
        window.history.replaceState(null, "", ROUTES[next]);
      }
    },
    [view],
  );

  const close = useCallback(() => {
    if (pushedRef.current) {
      // Unwind our own entry, which returns to whatever page opened the dialog
      // and keeps the rest of the back stack intact.
      pushedRef.current = false;
      window.history.back();
    } else {
      // Landed on an auth route directly: replace it, so Back goes wherever they
      // came from rather than straight back into the dialog.
      window.history.replaceState(null, "", "/");
    }
  }, []);

  const onOpenChange = useCallback(
    (next: boolean) => {
      if (next) show("signin");
      else close();
    },
    [close, show],
  );

  return {
    view,
    open: view !== null,
    onOpenChange,
    show,
    openSignin: useCallback(() => show("signin"), [show]),
  };
}
