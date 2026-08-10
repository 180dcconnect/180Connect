import { AppShell } from "@/components/app-shell";

export default function SettingsSegmentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AppShell>{children}</AppShell>;
}
