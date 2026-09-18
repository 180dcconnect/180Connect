"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { MotionConfig, MotionGlobalConfig } from "motion/react";
import {
  ACCESSIBILITY_FIELDS,
  DEFAULT_ACCESSIBILITY_SETTINGS,
  readAccessibilityCookies,
  type AccessibilitySettings,
} from "@/lib/accessibility";

/**
 * Two copies of the settings, deliberately:
 *
 * - `saved` — what is stored (cookies, and the account once saved).
 * - `applied` — what is on screen right now.
 *
 * They differ only while the Accessibility page is previewing an unsaved
 * choice. Picking an option previews it across the whole app; nothing is
 * stored until Save, and leaving the page without saving puts `saved` back.
 */
type AccessibilityContextValue = {
  saved: AccessibilitySettings;
  applied: AccessibilitySettings;
  /** Show settings on screen without storing them. */
  preview: (next: AccessibilitySettings) => void;
  /** Store settings in this browser and show them. */
  commit: (next: AccessibilitySettings) => void;
  /** Put the saved settings back on screen. */
  discardPreview: () => void;
};

const noop = () => {};

const AccessibilityContext = createContext<AccessibilityContextValue>({
  saved: DEFAULT_ACCESSIBILITY_SETTINGS,
  applied: DEFAULT_ACCESSIBILITY_SETTINGS,
  preview: noop,
  commit: noop,
  discardPreview: noop,
});

function applyToDocument(settings: AccessibilitySettings) {
  const root = document.documentElement;
  for (const field of ACCESSIBILITY_FIELDS) {
    const value = settings[field.key];
    if (value === field.values[0]) {
      root.removeAttribute(field.attribute);
    } else {
      root.setAttribute(field.attribute, value);
    }
  }
  // "No motion" has to reach JS animations too. CSS can only stop CSS
  // animations; Motion drives its own frames, and this flag makes every Motion
  // animation jump straight to its end state.
  MotionGlobalConfig.skipAnimations = settings.reducedMotion === "off";
}

function persist(settings: AccessibilitySettings) {
  const flags = `path=/; max-age=31536000; SameSite=Lax`;
  try {
    for (const field of ACCESSIBILITY_FIELDS) {
      const value = settings[field.key];
      // localStorage only so other open tabs hear about it (storage event).
      localStorage.setItem(field.cookie, value);
      document.cookie = `${field.cookie}=${value}; ${flags}`;
    }
  } catch {
    // Storage access may be restricted in sandboxed environments
  }
}

export function AccessibilityProvider({
  initialSettings,
  children,
}: {
  initialSettings: AccessibilitySettings;
  children: ReactNode;
}) {
  const [saved, setSaved] = useState<AccessibilitySettings>(initialSettings);
  const [applied, setApplied] = useState<AccessibilitySettings>(initialSettings);
  // Read by `discardPreview`, which must keep one identity for the life of the
  // provider: the Accessibility page calls it from an effect cleanup, and a new
  // function each render would run that cleanup — and wipe the preview — on
  // every render.
  const savedRef = useRef<AccessibilitySettings>(initialSettings);

  useEffect(() => {
    applyToDocument(applied);
  }, [applied]);

  useEffect(() => {
    function onStorage(event: StorageEvent) {
      if (!ACCESSIBILITY_FIELDS.some((field) => field.cookie === event.key)) return;
      try {
        const next = readAccessibilityCookies((name) => localStorage.getItem(name));
        savedRef.current = next;
        setSaved(next);
        setApplied(next);
      } catch {
        // Storage access may be restricted
      }
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const preview = useCallback((next: AccessibilitySettings) => {
    setApplied(next);
  }, []);

  const commit = useCallback((next: AccessibilitySettings) => {
    persist(next);
    savedRef.current = next;
    setSaved(next);
    setApplied(next);
  }, []);

  const discardPreview = useCallback(() => {
    setApplied(savedRef.current);
  }, []);

  return (
    <AccessibilityContext.Provider value={{ saved, applied, preview, commit, discardPreview }}>
      {/* The one reduced-motion switch for every Motion component. "user"
          follows the OS setting; the in-app setting forces it on. Components
          read it with `useReducedMotionConfig` — plain `useReducedMotion`
          only sees the OS and would ignore this. */}
      <MotionConfig reducedMotion={applied.reducedMotion === "normal" ? "user" : "always"}>
        {children}
      </MotionConfig>
    </AccessibilityContext.Provider>
  );
}

export function useAccessibility() {
  return useContext(AccessibilityContext);
}
