import { redirect } from "next/navigation";
import { getCurrentActor } from "@/lib/auth/actor";
import { Group, Rise, Stage } from "@/components/dashboard-stage";
import { AccessibilityForm } from "./accessibility-form";

/**
 * Accessibility settings (F205).
 *
 * Same skeleton as Profile & account — heading, one rail of facts, a card per
 * setting — in the Filed Record language (`docs/app-design-system.md`).
 *
 * No settings are read here: the form works from `AccessibilityProvider`,
 * which already holds what is saved and what is being previewed, and which the
 * account sync may have updated since this page's cookies were read.
 */
export default async function AccessibilitySettingsPage() {
  const authorization = await getCurrentActor(undefined, {
    route: "/settings/accessibility",
  });
  if (!authorization.ok) {
    redirect("/login");
  }

  return (
    <div className="min-h-screen bg-[#f4f4ef] px-6 py-10 sm:px-10 sm:py-12">
      <Stage className="w-full space-y-8">
        <Rise>
          <h1 className="font-body text-[clamp(2rem,4vw,2.75rem)] leading-[1] font-semibold tracking-[-0.03em] text-ink">
            Accessibility
          </h1>
          <p className="mt-5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-dim">
            <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-go" />
            <span>
              Choices preview as you pick them · <span className="text-ink">saved to your account</span>{" "}
              when you press Save, so they follow you to any device
            </span>
          </p>
        </Rise>

        <Group>
          <Rise>
            <AccessibilityForm />
          </Rise>
        </Group>
      </Stage>
    </div>
  );
}
