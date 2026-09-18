import { SettingsLoading } from "../settings-loading";

/** Mirrors page.tsx: heading, facts rail, then the preferences form. */
export default function Loading() {
  return <SettingsLoading title="Notifications" fact cards={[3, 4]} />;
}
