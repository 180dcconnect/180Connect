import { AppShell } from "@/components/app-shell";

export default function ProfileSegmentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AppShell>{children}</AppShell>;
}
