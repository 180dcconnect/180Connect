import { AppShell } from "@/components/app-shell";

export default function ActionsSegmentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AppShell>{children}</AppShell>;
}
