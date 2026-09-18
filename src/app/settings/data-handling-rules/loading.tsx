import { SettingsLoading } from "../settings-loading";

/** Mirrors page.tsx: heading, "protections on" facts rail, the rules, then the activity card. */
export default function Loading() {
  return <SettingsLoading title="Data handling rules" fact cards={[4, 2]} />;
}
