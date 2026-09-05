import { AppShell } from "@/components/app-shell";

export default function AnalyticsSegmentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AppShell>{children}</AppShell>;
}
