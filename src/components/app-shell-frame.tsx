import { Sidebar, type SidebarSection, type SidebarOnboarding } from "./sidebar";

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
  return (
    <div className="flex min-h-screen">
      <Sidebar
        sections={sections}
        userName={userName}
        userEmail={userEmail}
        roleLabel={roleLabel}
        onLogout={onLogout}
        initialCollapsed={initialCollapsed}
        onboarding={onboarding}
      />
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
