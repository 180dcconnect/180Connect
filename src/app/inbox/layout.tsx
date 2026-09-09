import { AppShell } from "@/components/app-shell";

/**
 * The /inbox route joins the app-shell segment so the persistent sidebar
 * (Dashboard, Clients, Inbox…) wraps it — same chrome as every other
 * signed-in page. Without this layout the inbox rendered bare, without
 * navigation back to the rest of the app.
 */
export default function InboxLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AppShell>{children}</AppShell>;
}
