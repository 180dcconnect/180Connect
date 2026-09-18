import { SettingsLoading } from "../settings-loading";

/** Mirrors page.tsx: heading, facts rail, then the accessibility form. */
export default function Loading() {
  return <SettingsLoading title="Accessibility" fact cards={[4]} />;
}
