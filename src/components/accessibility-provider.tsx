"use client";

import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import {
  type AccessibilitySettings,
  type FontSize,
  type ContrastMode,
  type LineSpacing,
  type ReducedMotion,
  DEFAULT_ACCESSIBILITY_SETTINGS,
  COOKIE_FONT_SIZE,
  COOKIE_CONTRAST,
  COOKIE_LINE_SPACING,
  COOKIE_REDUCED_MOTION,
} from "@/lib/accessibility";

type AccessibilityContextType = AccessibilitySettings & {
  updateSettings: (newSettings: Partial<AccessibilitySettings>) => void;
  resetSettings: () => void;
};

const AccessibilityContext = createContext<AccessibilityContextType>({
  ...DEFAULT_ACCESSIBILITY_SETTINGS,
  updateSettings: () => {},
  resetSettings: () => {},
});

function applyToDocument(settings: AccessibilitySettings) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;

  if (settings.fontSize === "normal") {
    root.removeAttribute("data-font-size");
  } else {
    root.setAttribute("data-font-size", settings.fontSize);
  }

  if (settings.contrast === "normal") {
    root.removeAttribute("data-contrast");
  } else {
    root.setAttribute("data-contrast", settings.contrast);
  }

  if (settings.lineSpacing === "normal") {
    root.removeAttribute("data-line-spacing");
  } else {
    root.setAttribute("data-line-spacing", settings.lineSpacing);
  }

  if (settings.reducedMotion === "normal") {
    root.removeAttribute("data-reduced-motion");
  } else {
    root.setAttribute("data-reduced-motion", settings.reducedMotion);
  }
}

function persistSettings(settings: AccessibilitySettings) {
  if (typeof window === "undefined") return;

  const maxAge = 31536000; // 1 year
  const cookieFlags = `path=/; max-age=${maxAge}; SameSite=Lax`;

  try {
    localStorage.setItem(COOKIE_FONT_SIZE, settings.fontSize);
    localStorage.setItem(COOKIE_CONTRAST, settings.contrast);
    localStorage.setItem(COOKIE_LINE_SPACING, settings.lineSpacing);
    localStorage.setItem(COOKIE_REDUCED_MOTION, settings.reducedMotion);

    document.cookie = `${COOKIE_FONT_SIZE}=${settings.fontSize}; ${cookieFlags}`;
    document.cookie = `${COOKIE_CONTRAST}=${settings.contrast}; ${cookieFlags}`;
    document.cookie = `${COOKIE_LINE_SPACING}=${settings.lineSpacing}; ${cookieFlags}`;
    document.cookie = `${COOKIE_REDUCED_MOTION}=${settings.reducedMotion}; ${cookieFlags}`;
  } catch {
    // Storage access may be restricted in sandboxed environments
  }
}

export function AccessibilityProvider({
  initialSettings,
  children,
}: {
  initialSettings: AccessibilitySettings;
  children: React.ReactNode;
}) {
  const [settings, setSettings] = useState<AccessibilitySettings>(initialSettings);

  useEffect(() => {
    applyToDocument(settings);

    function handleStorageChange(event: StorageEvent) {
      if (
        event.key === COOKIE_FONT_SIZE ||
        event.key === COOKIE_CONTRAST ||
        event.key === COOKIE_LINE_SPACING ||
        event.key === COOKIE_REDUCED_MOTION
      ) {
        try {
          const localFontSize = localStorage.getItem(COOKIE_FONT_SIZE) as FontSize | null;
          const localContrast = localStorage.getItem(COOKIE_CONTRAST) as ContrastMode | null;
          const localLineSpacing = localStorage.getItem(COOKIE_LINE_SPACING) as LineSpacing | null;
          const localReducedMotion = localStorage.getItem(COOKIE_REDUCED_MOTION) as ReducedMotion | null;

          const updated: AccessibilitySettings = {
            fontSize: localFontSize ?? initialSettings.fontSize,
            contrast: localContrast ?? initialSettings.contrast,
            lineSpacing: localLineSpacing ?? initialSettings.lineSpacing,
            reducedMotion: localReducedMotion ?? initialSettings.reducedMotion,
          };
          setSettings(updated);
          applyToDocument(updated);
        } catch {
          // Storage access may be restricted
        }
      }
    }

    window.addEventListener("storage", handleStorageChange);
    return () => {
      window.removeEventListener("storage", handleStorageChange);
    };
  }, [initialSettings, settings]);

  const updateSettings = useCallback((newSettings: Partial<AccessibilitySettings>) => {
    setSettings((prev) => {
      const updated: AccessibilitySettings = {
        ...prev,
        ...newSettings,
      };
      applyToDocument(updated);
      persistSettings(updated);
      return updated;
    });
  }, []);

  const resetSettings = useCallback(() => {
    setSettings(DEFAULT_ACCESSIBILITY_SETTINGS);
    applyToDocument(DEFAULT_ACCESSIBILITY_SETTINGS);
    persistSettings(DEFAULT_ACCESSIBILITY_SETTINGS);
  }, []);

  return (
    <AccessibilityContext.Provider
      value={{
        ...settings,
        updateSettings,
        resetSettings,
      }}
    >
      {children}
    </AccessibilityContext.Provider>
  );
}

export function useAccessibility() {
  return useContext(AccessibilityContext);
}
