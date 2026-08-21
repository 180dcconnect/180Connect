"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { Sidebar, type SidebarSection, type SidebarOnboarding } from "./sidebar";

/**
 * Below `md` the rail is a drawer: it leaves the flow, slides in over the
 * page behind a scrim, and this bar with a burger takes its place. Collapse
 * (icon rail) stays a desktop-only idea — the drawer is always shown wide,
 * with labels — so nothing here reads `initialCollapsed`.
 */
export function AppShellFrame({
  sections,
  userName,
  userEmail,
  roleLabel,
  onLogout,
  initialCollapsed,
  onboarding,
  children,
}: {
  sections: SidebarSection[];
  userName?: string | null;
  userEmail?: string | null;
  roleLabel: string;
  onLogout: () => Promise<void>;
  initialCollapsed?: boolean;
  onboarding?: SidebarOnboarding;
  children: React.ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();

  // A navigation is the clearest signal the drawer's job is done.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!mobileOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [mobileOpen]);

  return (
    <div className="flex min-h-screen">
      <Sidebar
        sections={sections}
        userName={userName}
        userEmail={userEmail}
        roleLabel={roleLabel}
        onLogout={onLogout}
        initialCollapsed={initialCollapsed}
        mobileOpen={mobileOpen}
        onMobileClose={() => setMobileOpen(false)}
        onboarding={onboarding}
      />

      {mobileOpen && (
        <div
          aria-hidden="true"
          onClick={() => setMobileOpen(false)}
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
        />
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b border-black/10 bg-white/80 px-4 backdrop-blur-xl md:hidden">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            aria-label="Open navigation"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-black/70 transition-all hover:bg-black/10 hover:text-black focus-visible:outline-none"
          >
            <Menu className="h-5 w-5" strokeWidth={1.8} aria-hidden="true" />
          </button>
          <span className="truncate text-base font-extrabold tracking-tight text-black">180Connect</span>
        </div>

        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
