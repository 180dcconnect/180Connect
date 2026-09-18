import { SettingsLoading } from "../settings-loading";

/** Mirrors page.tsx: heading, "last changed" facts rail, then the settings panel. */
export default function Loading() {
  return <SettingsLoading title="Score settings" fact cards={[4, 3, 2]} />;
}
