"use client";

import { useEffect } from "react";
import { useAccessibility } from "@/components/accessibility-provider";
import {
  ACCESSIBILITY_FIELDS,
  isDefaultAccessibilitySettings,
  sameAccessibilitySettings,
} from "@/lib/accessibility";
import {
  loadAccountAccessibilityAction,
  saveAccessibilitySettingsAction,
} from "@/app/settings/accessibility/actions";

/**
 * Makes accessibility settings follow the account, not the browser.
 *
 * The page render still reads cookies — they are what lets the server paint
 * the right `<html>` attributes with no flash — so the account is reconciled
 * into the cookies once per tab session, per user:
 *
 * - Account has settings that differ from this browser → adopt the account's.
 *   (A new device paints defaults for one load, then corrects itself; every
 *   load after that is right from the server.)
 * - Account has never saved any, but this browser has non-defaults → push this
 *   browser's up, so settings chosen before sync existed are not lost.
 *
 * Deliberately not part of `getCurrentActor`'s profile select: that read runs
 * on every page, and a missing column there (an environment the migration has
 * not reached yet) would fail sign-in everywhere. Here it just does nothing.
 */
export function AccessibilityAccountSync({ userId }: { userId: string }) {
  const { saved, commit } = useAccessibility();

  useEffect(() => {
    const key = `accessibility_account_synced:${userId}`;
    try {
      if (sessionStorage.getItem(key)) return;
    } catch {
      return;
    }

    let cancelled = false;
    loadAccountAccessibilityAction().then(async (account) => {
      if (cancelled || account.status !== "ok") return;
      try {
        sessionStorage.setItem(key, "1");
      } catch {
        // Worst case this runs again next navigation.
      }

      if (account.settings) {
        if (!sameAccessibilitySettings(account.settings, saved)) commit(account.settings);
      } else if (!isDefaultAccessibilitySettings(saved)) {
        const formData = new FormData();
        for (const field of ACCESSIBILITY_FIELDS) formData.set(field.key, saved[field.key]);
        await saveAccessibilitySettingsAction({ status: "idle" }, formData);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [userId, saved, commit]);

  return null;
}
