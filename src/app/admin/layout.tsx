import { AppShell } from "@/components/app-shell";

export default function AdminSegmentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AppShell>{children}</AppShell>;
}
