import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getCurrentActor } from "@/lib/auth/actor";
import { Rise, Stage } from "@/components/dashboard-stage";
import { AccessibilityForm } from "./accessibility-form";
import {
  parseAccessibilitySettings,
  DEFAULT_ACCESSIBILITY_SETTINGS,
  COOKIE_FONT_SIZE,
  COOKIE_CONTRAST,
  COOKIE_LINE_SPACING,
  COOKIE_REDUCED_MOTION,
} from "@/lib/accessibility";

export default async function AccessibilitySettingsPage() {
  const authorization = await getCurrentActor(undefined, {
    route: "/settings/accessibility",
  });
  if (!authorization.ok) {
    redirect("/login");
  }

  const cookieStore = await cookies();
  const parsed = parseAccessibilitySettings({
    fontSize: cookieStore.get(COOKIE_FONT_SIZE)?.value,
    contrast: cookieStore.get(COOKIE_CONTRAST)?.value,
    lineSpacing: cookieStore.get(COOKIE_LINE_SPACING)?.value,
    reducedMotion: cookieStore.get(COOKIE_REDUCED_MOTION)?.value,
  });

  const initialSettings = parsed.ok ? parsed.value : DEFAULT_ACCESSIBILITY_SETTINGS;

  return (
    <div className="min-h-screen bg-[#f4f4ef] px-6 py-10 sm:px-10 sm:py-12">
      <Stage className="mx-auto w-full max-w-2xl space-y-10">
        <Rise>
          <h1 className="text-[clamp(2rem,4vw,2.75rem)] font-semibold font-body leading-[1] tracking-[-0.03em]">
            Accessibility Settings
          </h1>
          <p className="mt-3 text-sm leading-[1.7] text-foreground/65">
            Configure text size, contrast, line spacing, and motion across 180Connect.
          </p>
        </Rise>

        <Rise>
          <AccessibilityForm initialSettings={initialSettings} />
        </Rise>
      </Stage>
    </div>
  );
}
