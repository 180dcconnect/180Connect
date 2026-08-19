"use client";

import { useSyncExternalStore } from "react";
import { X } from "lucide-react";

const STORAGE_KEY = "staging_banner_dismissed";

const emptySubscribe = () => () => {};

function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  return () => window.removeEventListener("storage", callback);
}

function getSnapshot() {
  try {
    return sessionStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function getServerSnapshot() {
  return false;
}

/**
 * Shown on every signed-in page when NEXT_PUBLIC_ENV=staging, so external
 * accounts (e.g. a client preview) know this is not production: data can
 * change under them and the environment can be briefly unstable mid-deploy.
 * Can be dismissed with the close ('X') button for the current session.
 */
export function StagingBanner() {
  const isDismissed = useSyncExternalStore(
    typeof window !== "undefined" ? subscribe : emptySubscribe,
    getSnapshot,
    getServerSnapshot
  );

  if (process.env.NEXT_PUBLIC_ENV !== "staging" || isDismissed) return null;

  const handleDismiss = () => {
    try {
      sessionStorage.setItem(STORAGE_KEY, "true");
      window.dispatchEvent(new Event("storage"));
    } catch {
      // Ignore sessionStorage write errors
    }
  };

  return (
    <div
      role="status"
      className="relative bg-amber-50 px-8 py-2 text-center text-sm font-bold text-amber-900"
    >
      <span>
        Preview environment — data here may change or reset, and the app can be briefly
        unstable during deploys.
      </span>
      <button
        type="button"
        onClick={handleDismiss}
        aria-label="Dismiss preview notice"
        className="absolute right-2 sm:right-4 top-1/2 -translate-y-1/2 inline-flex items-center justify-center p-1 rounded-md text-amber-900/70 hover:text-amber-900 hover:bg-amber-100 transition-colors focus-visible:outline-2 focus-visible:outline-amber-600"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
