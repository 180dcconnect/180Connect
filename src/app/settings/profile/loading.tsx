import { SettingsLoading } from "../settings-loading";

/** Mirrors page.tsx: heading (no facts rail), the profile card, the password card. */
export default function Loading() {
  return <SettingsLoading title="Profile & account" cards={[3, 1]} />;
}
