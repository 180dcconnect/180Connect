import { redirect } from "next/navigation";

/**
 * `/settings` is an address, not a screen. The rail already lists every section,
 * so an index page would be a second copy of that list with nothing else on it.
 * Profile is the landing tab because it is the one every role has.
 */
export default function SettingsIndexPage() {
  redirect("/settings/profile");
}
