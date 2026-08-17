import { Sidebar, type SidebarSection } from "./sidebar";

export function AppShellFrame({
  sections,
  userName,
  userEmail,
  roleLabel,
  onLogout,
  initialCollapsed,
  children,
}: {
  sections: SidebarSection[];
  userName?: string | null;
  userEmail?: string | null;
  roleLabel: string;
  onLogout: () => Promise<void>;
  initialCollapsed?: boolean;
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
      />
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
