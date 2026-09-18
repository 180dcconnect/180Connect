import { SettingsLoading } from "../settings-loading";

/** Mirrors page.tsx: heading (no facts rail), then the one sending-limit card. */
export default function Loading() {
  return <SettingsLoading title="Outreach sending limit" cards={[2]} />;
}
