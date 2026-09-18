import { SettingsLoading } from "../settings-loading";

/** Mirrors page.tsx: heading, "fields locked" facts rail, then the fields panel. */
export default function Loading() {
  return <SettingsLoading title="Restricted fields" fact cards={[6]} />;
}
