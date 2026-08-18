"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { actorFailureMessage, getCurrentActor } from "@/lib/auth/actor";
import {
  parseAccessibilitySettings,
  type AccessibilitySettings,
  COOKIE_FONT_SIZE,
  COOKIE_CONTRAST,
  COOKIE_LINE_SPACING,
  COOKIE_REDUCED_MOTION,
} from "@/lib/accessibility";

export type AccessibilityFormState = {
  status: "idle" | "error" | "success";
  message?: string;
  settings?: AccessibilitySettings;
};

/**
 * Persists text accessibility settings (F205) via cookies and revalidates all views.
 */
export async function saveAccessibilitySettingsAction(
  _previousState: AccessibilityFormState,
  formData: FormData,
): Promise<AccessibilityFormState> {
  const authorization = await getCurrentActor(undefined, {
    route: "/settings/accessibility",
  });
  if (!authorization.ok) {
    return { status: "error", message: actorFailureMessage(authorization.reason) };
  }

  const parsed = parseAccessibilitySettings({
    fontSize: formData.get("fontSize"),
    contrast: formData.get("contrast"),
    lineSpacing: formData.get("lineSpacing"),
    reducedMotion: formData.get("reducedMotion"),
  });

  if (!parsed.ok) {
    return { status: "error", message: parsed.message };
  }

  const cookieStore = await cookies();
  const maxAge = 31536000; // 1 year
  const cookieOptions = {
    path: "/",
    maxAge,
    sameSite: "lax" as const,
  };

  cookieStore.set(COOKIE_FONT_SIZE, parsed.value.fontSize, cookieOptions);
  cookieStore.set(COOKIE_CONTRAST, parsed.value.contrast, cookieOptions);
  cookieStore.set(COOKIE_LINE_SPACING, parsed.value.lineSpacing, cookieOptions);
  cookieStore.set(COOKIE_REDUCED_MOTION, parsed.value.reducedMotion, cookieOptions);

  revalidatePath("/", "layout");
  revalidatePath("/settings/accessibility");

  return {
    status: "success",
    message: "Accessibility preferences saved.",
    settings: parsed.value,
  };
}
