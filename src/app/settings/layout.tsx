import { SettingsShell } from "@/components/settings-shell";

export default function SettingsSegmentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <SettingsShell>{children}</SettingsShell>;
}
