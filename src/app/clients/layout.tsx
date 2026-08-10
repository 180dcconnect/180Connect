import { AppShell } from "@/components/app-shell";

export default function ClientsSegmentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AppShell>{children}</AppShell>;
}
