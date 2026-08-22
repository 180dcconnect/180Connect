import { AppShell } from "@/components/app-shell";

export default function TeamLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AppShell>{children}</AppShell>;
}
