import { AppShell } from "@/components/app-shell";
import { ToastProvider } from "@/components/ui/toast";

/**
 * The signed-in app's one shell: sidebar + content area, for every section in
 * this route group — dashboard, clients, inbox, actions, analytics, admin, team
 * and profile. The `(app)` folder name is not part of any URL.
 *
 * Each of those sections used to carry its own `layout.tsx` rendering
 * `<AppShell>`. Layouts are only kept across a navigation when the two pages
 * share them, so every move between sections (Dashboard → Clients → Inbox)
 * threw the sidebar away and rebuilt it on the server: another actor and
 * onboarding read, another render, and a sidebar remounted from scratch. With
 * one layout above all of them, only the page underneath changes.
 *
 * Because the shell no longer re-renders on navigation, anything that changes
 * what the sidebar shows has to revalidate the layout — see the onboarding
 * actions in src/lib/onboarding-actions.ts.
 *
 * Settings stays outside this group on purpose: it has its own shell and its
 * own sidebar (see src/app/settings/layout.tsx).
 *
 * `ToastProvider` sits here for the same reason the shell does: one live region
 * for the whole signed-in app, so a screen that saves something can confirm it
 * without mounting a toaster of its own.
 */
export default function SignedInLayout({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <AppShell>{children}</AppShell>
    </ToastProvider>
  );
}
